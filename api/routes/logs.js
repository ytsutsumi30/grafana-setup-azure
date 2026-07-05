/**
 * logs API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /logs と /api/logs
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const fs = require('fs');
const path = require('path');

module.exports = function (requireAdmin) {
  const router = express.Router();

router.get('/files', requireAdmin, async (req, res) => {
    try {
        const logDir = '/app';
        const logFiles = ['error.log', 'combined.log'];

        const files = logFiles
            .filter(file => fs.existsSync(path.join(logDir, file)))
            .map(file => {
                const filePath = path.join(logDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: `${(stats.size / 1024).toFixed(2)} KB`,
                    modified_at: stats.mtime,
                    path: filePath
                };
            });

        res.json(files);
    } catch (error) {
        logger.error('Error fetching log files:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ログ内容取得
router.get('/content/:filename', requireAdmin, async (req, res) => {
    try {
        const { filename } = req.params;
        const { lines = 100, level } = req.query;

        // セキュリティ: ファイル名のバリデーション
        const allowedFiles = ['error.log', 'combined.log'];
        if (!allowedFiles.includes(filename)) {
            return res.status(400).json({ error: 'Invalid log file' });
        }

        const logPath = path.join('/app', filename);

        if (!fs.existsSync(logPath)) {
            return res.status(404).json({ error: 'Log file not found' });
        }

        // ファイルを読み込み
        const content = fs.readFileSync(logPath, 'utf8');
        const allLines = content.split('\n').filter(line => line.trim());

        // レベルフィルタリング
        let filteredLines = allLines;
        if (level) {
            filteredLines = allLines.filter(line => {
                try {
                    const parsed = JSON.parse(line);
                    return parsed.level === level;
                } catch (e) {
                    return line.toLowerCase().includes(level.toLowerCase());
                }
            });
        }

        // 最新N行を取得
        const recentLines = filteredLines.slice(-parseInt(lines));

        // JSON形式でパース試行
        const parsedLines = recentLines.map(line => {
            try {
                return JSON.parse(line);
            } catch (e) {
                return { raw: line };
            }
        }).reverse(); // 新しい順に

        res.json({
            filename,
            total_lines: allLines.length,
            filtered_lines: filteredLines.length,
            returned_lines: parsedLines.length,
            logs: parsedLines
        });
    } catch (error) {
        logger.error('Error reading log file:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==============================================
// 新QC七つ道具 API
// ==============================================

// --- プロジェクト管理 ---

// プロジェクト一覧取得
// new-qc API はルーターへ分離(routes/new-qc.js)

  return router;
};
