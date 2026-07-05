/**
 * database API ルーター(server.js から抽出、振る舞い不変。重複定義・順序も保持)
 * マウント: /database と /api/database
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const util = require('util');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);

module.exports = function (requireAdmin) {
  const router = express.Router();

router.get('/stats', requireAdmin, async (req, res) => {
    try {
        // テーブル一覧と行数
        const tablesResult = await pool.query(`
            SELECT
                schemaname,
                tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        `);

        // 各テーブルの行数を取得
        const tables = [];
        for (const table of tablesResult.rows) {
            const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table.tablename}`);
            tables.push({
                name: table.tablename,
                size: table.size,
                row_count: parseInt(countResult.rows[0].count)
            });
        }

        // データベース全体のサイズ
        const dbSizeResult = await pool.query(`
            SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `);

        res.json({
            database_size: dbSizeResult.rows[0].size,
            table_count: tables.length,
            tables: tables
        });
    } catch (error) {
        logger.error('Error fetching database stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// バックアップ作成

router.post('/backup', requireAdmin, async (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
            new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        const backupDir = '/app/backups';
        const backupFile = `backup_${timestamp}.sql`;
        const backupPath = path.join(backupDir, backupFile);

        // バックアップディレクトリが存在しない場合は作成
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const dbUser = process.env.DB_USER || 'production_user';
        const dbName = process.env.DB_NAME || 'production_db';
        const dbHost = process.env.DB_HOST || 'postgres';
        const dbPassword = process.env.DB_PASSWORD || 'production_password';

        // pg_dumpコマンドを実行
        const command = `PGPASSWORD="${dbPassword}" pg_dump -h ${dbHost} -U ${dbUser} -d ${dbName} > ${backupPath}`;

        await execPromise(command);

        // ファイルサイズを取得
        const stats = fs.statSync(backupPath);
        const fileSizeInBytes = stats.size;
        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);

        logger.info('Database backup created:', backupFile);

        res.json({
            success: true,
            message: 'バックアップが正常に作成されました',
            filename: backupFile,
            size: `${fileSizeInMB} MB`,
            created_at: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Error creating backup:', error);
        res.status(500).json({
            success: false,
            error: 'バックアップの作成に失敗しました',
            details: error.message
        });
    }
});

// バックアップ一覧取得

router.get('/backups', requireAdmin, async (req, res) => {
    try {
        const backupDir = '/app/backups';

        // ディレクトリが存在しない場合は空配列を返す
        if (!fs.existsSync(backupDir)) {
            return res.json([]);
        }

        const files = fs.readdirSync(backupDir)
            .filter(file => file.endsWith('.sql'))
            .map(file => {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
                    created_at: stats.mtime,
                    path: filePath
                };
            })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json(files);
    } catch (error) {
        logger.error('Error fetching backups:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === システムログAPI ===

// ログファイル一覧取得
// logs API はルーターへ分離(routes/logs.js)

router.get('/backup', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        logger.info('Database backup requested');

        // バックアップ対象テーブルの順序（外部キー制約を考慮）
        const tables = [
            'products',
            'shipping_locations',
            'delivery_locations',
            'production_plans',
            'production_records',
            'inventory',
            'inspections',
            'shipping_instructions',
            'shipping_inspections',
            'product_components',
            'qr_inspections',
            'qr_inspection_details',
            'inspectors',
            'inventory_snapshots',
            'performance_metrics',
            'system_alerts'
        ];

        let sqlOutput = '';

        // SQLヘッダー
        sqlOutput += `-- Production Management System Database Backup\n`;
        sqlOutput += `-- Generated: ${new Date().toISOString()}\n`;
        sqlOutput += `-- Database: production_db\n\n`;
        sqlOutput += `BEGIN;\n\n`;

        // 外部キー制約を一時的に無効化
        sqlOutput += `-- Disable foreign key constraints\n`;
        sqlOutput += `SET session_replication_role = 'replica';\n\n`;

        // 各テーブルのデータをバックアップ
        for (const table of tables) {
            try {
                // テーブルが存在するか確認
                const tableCheck = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables
                        WHERE table_schema = 'public'
                        AND table_name = $1
                    )
                `, [table]);

                if (!tableCheck.rows[0].exists) {
                    logger.warn(`Table ${table} does not exist, skipping...`);
                    continue;
                }

                // テーブルのカラム情報を取得
                const columnsResult = await client.query(`
                    SELECT column_name, data_type, is_generated
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = $1
                    ORDER BY ordinal_position
                `, [table]);

                // GENERATED列を除外
                const insertableColumns = columnsResult.rows
                    .filter(col => col.is_generated === 'NEVER')
                    .map(col => col.column_name);

                if (insertableColumns.length === 0) {
                    logger.warn(`Table ${table} has no insertable columns, skipping...`);
                    continue;
                }

                // データを取得
                const dataResult = await client.query(`
                    SELECT ${insertableColumns.map(col => `"${col}"`).join(', ')}
                    FROM ${table}
                    ORDER BY id
                `);

                if (dataResult.rows.length === 0) {
                    sqlOutput += `-- Table: ${table} (no data)\n\n`;
                    continue;
                }

                sqlOutput += `-- Table: ${table} (${dataResult.rows.length} rows)\n`;
                sqlOutput += `DELETE FROM ${table};\n`;

                // シーケンスのリセット（idカラムがある場合）
                if (insertableColumns.includes('id')) {
                    const maxIdResult = await client.query(`SELECT MAX(id) as max_id FROM ${table}`);
                    const maxId = maxIdResult.rows[0].max_id || 0;
                    if (maxId > 0) {
                        sqlOutput += `SELECT setval('${table}_id_seq', ${maxId}, true);\n`;
                    }
                }

                // INSERT文を生成
                for (const row of dataResult.rows) {
                    const values = insertableColumns.map(col => {
                        const value = row[col];
                        if (value === null) {
                            return 'NULL';
                        } else if (typeof value === 'string') {
                            return `'${value.replace(/'/g, "''")}'`;
                        } else if (value instanceof Date) {
                            return `'${value.toISOString()}'`;
                        } else if (typeof value === 'boolean') {
                            return value ? 'true' : 'false';
                        } else if (typeof value === 'object') {
                            return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
                        } else {
                            return value;
                        }
                    });

                    sqlOutput += `INSERT INTO ${table} (${insertableColumns.map(col => `"${col}"`).join(', ')}) VALUES (${values.join(', ')});\n`;
                }

                sqlOutput += `\n`;

            } catch (tableError) {
                logger.error(`Error backing up table ${table}:`, tableError);
                sqlOutput += `-- Error backing up table ${table}: ${tableError.message}\n\n`;
            }
        }

        // 外部キー制約を再有効化
        sqlOutput += `-- Re-enable foreign key constraints\n`;
        sqlOutput += `SET session_replication_role = 'origin';\n\n`;

        sqlOutput += `COMMIT;\n`;
        sqlOutput += `\n-- Backup completed\n`;

        // ファイル名を生成
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = `production_db_backup_${timestamp}.sql`;

        // SQLファイルとして返す
        res.setHeader('Content-Type', 'application/sql');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(sqlOutput);

        logger.info(`Database backup generated: ${filename}`);

    } catch (error) {
        logger.error('Error generating database backup:', error);
        res.status(500).json({ error: 'Failed to generate backup', details: error.message });
    } finally {
        client.release();
    }
});

// データベース復元

router.post('/restore', requireAdmin, async (req, res) => {
    const client = await pool.connect();

    try {
        logger.info('Database restore requested');

        // リクエストボディからSQLを取得
        const { sql } = req.body;

        if (!sql || typeof sql !== 'string') {
            return res.status(400).json({ error: 'SQL content is required' });
        }

        // SQLの長さチェック（10MBまで）
        if (sql.length > 10 * 1024 * 1024) {
            return res.status(400).json({ error: 'SQL file is too large (max 10MB)' });
        }

        logger.info(`Restoring database from SQL (${sql.length} bytes)`);

        // トランザクション開始
        await client.query('BEGIN');

        try {
            // SQLを実行（複数ステートメント対応）
            await client.query(sql);

            await client.query('COMMIT');

            logger.info('Database restore completed successfully');
            res.json({
                success: true,
                message: 'データベースを復元しました',
                bytes: sql.length
            });

        } catch (executeError) {
            await client.query('ROLLBACK');
            throw executeError;
        }

    } catch (error) {
        logger.error('Error restoring database:', error);
        res.status(500).json({
            error: 'データベースの復元に失敗しました',
            details: error.message
        });
    } finally {
        client.release();
    }
});

// === ロット在庫 API ===

// ロット在庫一覧取得
// lot-inventory API はルーターへ分離(routes/lot-inventory.js)
// picking-instructions API はルーターへ分離(routes/picking-instructions.js)
// packing-records API はルーターへ分離(routes/packing-records.js)

  return router;
};
