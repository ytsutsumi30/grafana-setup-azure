/**
 * system-config API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /system-config と /api/system-config
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const systemConfig = require('../lib/config');

const router = express.Router();

router.get('/', (req, res) => {
    res.json(systemConfig);
});

// システム設定更新
router.patch('/', (req, res) => {
    try {
        const { pocMode, enableQRInspectionDB } = req.body;

        if (typeof pocMode === 'boolean') {
            systemConfig.pocMode = pocMode;
        }

        if (typeof enableQRInspectionDB === 'boolean') {
            systemConfig.enableQRInspectionDB = enableQRInspectionDB;
        }

        systemConfig.lastUpdated = new Date().toISOString();

        logger.info('System config updated:', systemConfig);

        res.json({
            success: true,
            message: 'システム設定を更新しました',
            config: systemConfig
        });
    } catch (error) {
        logger.error('Error updating system config:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
