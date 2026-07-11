const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// OCRルートのインポート
const ocrRoutes = require('./routes/ocr');
const ocrEnhanceRoutes = require('./routes/ocr-enhance');
const ocrAiRoutes = require('./routes/ocr-ai');
const createOcrFeedbackRoutes = require('./routes/ocr-feedback');
const ocrImportsRoutes = require('./routes/ocr-imports');
const reportsRoutes = require('./routes/reports');
const qcToolsRoutes = require('./routes/qc-tools');
const monitoringRoutes = require('./routes/monitoring');
const productionPlansRoutes = require('./routes/production-plans');
const shippingLocationsRoutes = require('./routes/shipping-locations');
const deliveryLocationsRoutes = require('./routes/delivery-locations');
const productComponentsRoutes = require('./routes/product-components');
const inventoryRoutes = require('./routes/inventory');
const inspectorsRoutes = require('./routes/inspectors');
const newQcRoutes = require('./routes/new-qc');
const lotInventoryRoutes = require('./routes/lot-inventory');
const qrUnitsRoutes = require('./routes/qr-units');
const inventoryCountsRoutes = require('./routes/inventory-counts');
const suppliersRoutes = require('./routes/suppliers');
const purchaseOrdersRoutes = require('./routes/purchase-orders');
const receivingOrdersRoutes = require('./routes/receiving-orders');
const salesOrdersRoutes = require('./routes/sales-orders');
const manufacturingOrdersRoutes = require('./routes/manufacturing-orders');
const traceabilityRoutes = require('./routes/traceability');
const pickingInstructionsRoutes = require('./routes/picking-instructions');
const packingRecordsRoutes = require('./routes/packing-records');
const logsRoutes = require('./routes/logs');
const qrInspectionsRoutes = require('./routes/qr-inspections');
const systemConfigRoutes = require('./routes/system-config');
const productsRoutes = require('./routes/products');
const shippingInspectionsRoutes = require('./routes/shipping-inspections');
const shippingInstructionsRoutes = require('./routes/shipping-instructions');
const shippingLotsRoutes = require('./routes/shipping-lots');
const databaseRoutes = require('./routes/database');

// ログ設定(共有ロガー)
const logger = require('./lib/logger');

// データベース接続設定(共有プール)
const pool = require('./lib/db');

// Express アプリケーション設定
const app = express();
const PORT = process.env.PORT || 3001;

const auth = require('./lib/auth')(logger);
const cookieParser = require('cookie-parser');
const oidc = require('./lib/oidc')(logger);
const { m365AuthConfig, getBearerToken, validateM365Token, requireAdmin } = auth;
const configurationErrors = auth.validateProductionConfiguration();
if (configurationErrors.length) {
    throw new Error(`Invalid production security configuration: ${configurationErrors.join('; ')}`);
}

// プロキシ信頼設定（nginxリバースプロキシ対応）
app.set('trust proxy', 1);

// ミドルウェア設定
app.use(helmet());
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// レート制限（プロキシ対応）
const limiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000), // 15分
    max: Number(process.env.RATE_LIMIT_MAX || 100), // リクエスト数制限
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // プロキシ環境での正確なIP取得
    trustProxy: true,
    keyGenerator: (req) => {
        // X-Forwarded-Forから実際のクライアントIPを取得
        return req.ip || req.connection.remoteAddress;
    }
});
app.use(limiter);

// リクエストログ
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
});

// 更新系(POST/PUT/PATCH/DELETE)の段階認証(lib/auth の writeAuth)
// WRITE_AUTH_MODE=off|warn|enforce で制御(本番の未指定値は enforce)。
app.use(auth.writeAuth);

// ヘルスチェック
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- 自前 OIDC(案C): Google / Microsoft SSO ---
app.get('/auth/whoami', oidc.whoami);
app.get('/auth/login/:provider', oidc.login);
app.get('/auth/callback/:provider', oidc.callback);
app.get('/auth/logout', oidc.logout);

app.get('/auth/m365/config', (req, res) => {
    res.json({
        enabled: m365AuthConfig.enabled,
        required: m365AuthConfig.enabled && m365AuthConfig.required,
        tenantId: m365AuthConfig.enabled ? m365AuthConfig.tenantId : '',
        clientId: m365AuthConfig.enabled ? m365AuthConfig.clientId : '',
        authority: m365AuthConfig.enabled ? `https://login.microsoftonline.com/${m365AuthConfig.tenantId}` : '',
        scopes: m365AuthConfig.enabled ? m365AuthConfig.scopes : [],
        cacheLocation: process.env.M365_AUTH_CACHE_LOCATION || 'localStorage'
    });
});

app.get('/auth/m365/me', async (req, res) => {
    if (!m365AuthConfig.enabled) {
        return res.status(404).json({ error: 'M365 authentication is disabled' });
    }
    try {
        const user = await validateM365Token(getBearerToken(req));
        if (!user) {
            return res.status(401).json({ error: 'Invalid or missing M365 token' });
        }
        res.json({ user });
    } catch (error) {
        logger.error('M365 user validation error:', error);
        res.status(502).json({ error: 'Microsoft Graph validation failed' });
    }
});

// M365 required 時の全体強制(lib/auth の requiredAuth)
app.use(auth.requiredAuth);

// OIDC ウォール(AUTH_WALL=on かつ SESSION_SECRET・プロバイダ設定時のみ有効。既定は no-op)
app.use(oidc.wall);

// === OCR API（AWS Textract） ===
app.use('/api/ocr-ai', ocrAiRoutes);
app.use('/api/ocr-feedback', createOcrFeedbackRoutes({ requireAdmin }));
app.use('/ocr-imports', ocrImportsRoutes);
app.use('/api/ocr-imports', ocrImportsRoutes);
app.use('/ocr', ocrRoutes);
app.use('/api/ocr', ocrEnhanceRoutes);
app.use('/reports', reportsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/qc-tools', qcToolsRoutes(requireAdmin));
app.use('/api/qc-tools', qcToolsRoutes(requireAdmin));
app.use('/monitoring', monitoringRoutes(requireAdmin));
app.use('/api/monitoring', monitoringRoutes(requireAdmin));
app.use('/production-plans', productionPlansRoutes);
app.use('/api/production-plans', productionPlansRoutes);
app.use('/shipping-locations', shippingLocationsRoutes);
app.use('/api/shipping-locations', shippingLocationsRoutes);
app.use('/delivery-locations', deliveryLocationsRoutes);
app.use('/api/delivery-locations', deliveryLocationsRoutes);
app.use('/product-components', productComponentsRoutes);
app.use('/api/product-components', productComponentsRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/inspectors', inspectorsRoutes);
app.use('/api/inspectors', inspectorsRoutes);
app.use('/new-qc', newQcRoutes);
app.use('/api/new-qc', newQcRoutes);
app.use('/lot-inventory', lotInventoryRoutes);
app.use('/api/lot-inventory', lotInventoryRoutes);
app.use('/qr-units', qrUnitsRoutes);
app.use('/api/qr-units', qrUnitsRoutes);
app.use('/inventory-counts', inventoryCountsRoutes);
app.use('/api/inventory-counts', inventoryCountsRoutes);
app.use('/suppliers', suppliersRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/purchase-orders', purchaseOrdersRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/receiving-orders', receivingOrdersRoutes);
app.use('/api/receiving-orders', receivingOrdersRoutes);
app.use('/sales-orders', salesOrdersRoutes);
app.use('/api/sales-orders', salesOrdersRoutes);
app.use('/manufacturing-orders', manufacturingOrdersRoutes);
app.use('/api/manufacturing-orders', manufacturingOrdersRoutes);
app.use('/traceability', traceabilityRoutes);
app.use('/api/traceability', traceabilityRoutes);
app.use('/picking-instructions', pickingInstructionsRoutes);
app.use('/api/picking-instructions', pickingInstructionsRoutes);
app.use('/packing-records', packingRecordsRoutes);
app.use('/api/packing-records', packingRecordsRoutes);
app.use('/logs', logsRoutes(requireAdmin));
app.use('/api/logs', logsRoutes(requireAdmin));
app.use('/qr-inspections', qrInspectionsRoutes);
app.use('/api/qr-inspections', qrInspectionsRoutes);
app.use('/system-config', systemConfigRoutes);
app.use('/api/system-config', systemConfigRoutes);
app.use('/products', productsRoutes);
app.use('/api/products', productsRoutes);
app.use('/shipping-inspections', shippingInspectionsRoutes);
app.use('/api/shipping-inspections', shippingInspectionsRoutes);
app.use('/shipping-instructions', shippingInstructionsRoutes);
app.use('/api/shipping-instructions', shippingInstructionsRoutes);
app.use('/shipping-instruction-lines', shippingLotsRoutes);
app.use('/api/shipping-instruction-lines', shippingLotsRoutes);
app.use('/database', databaseRoutes(requireAdmin));
app.use('/api/database', databaseRoutes(requireAdmin));
// データベース接続テストは管理者限定。公開エンドポイントから接続状態を露出しない。
app.get('/db-test', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({
            status: 'Database connected',
            time: result.rows[0].now
        });
    } catch (error) {
        logger.error('Database connection error:', error);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// === システム設定API（POCモード制御） ===

// システム設定取得
// system-config API はルーターへ分離(routes/system-config.js)
// 404ハンドラー
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// サーバー起動
app.listen(PORT, () => {
    logger.info(`Production Management API server running on port ${PORT}`);
});

// グレースフルシャットダウン
process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    pool.end();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received. Shutting down gracefully...');
    pool.end();
    process.exit(0);
});
