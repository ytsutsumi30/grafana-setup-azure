/**
 * 共有 PostgreSQL 接続プール
 * server.js とルーターモジュールで同一プールを共有する。
 * SSL は DB_SSL=true のときのみ有効(ローカル PostgreSQL では無効)。
 */
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'production_db',
    user: process.env.DB_USER || 'production_user',
    password: process.env.DB_PASSWORD || 'production_pass',
    ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false // RDS自己署名証明書対応
    } : false
});

module.exports = pool;
