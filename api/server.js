const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const { Pool } = require('pg');
const Joi = require('joi');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
require('dotenv').config();

const execPromise = util.promisify(exec);

// OCRルートのインポート
const ocrRoutes = require('./routes/ocr');
const ocrEnhanceRoutes = require('./routes/ocr-enhance');
const ocrAiRoutes = require('./routes/ocr-ai');
const ocrFeedbackRoutes = require('./routes/ocr-feedback');
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
const pickingInstructionsRoutes = require('./routes/picking-instructions');
const packingRecordsRoutes = require('./routes/packing-records');
const logsRoutes = require('./routes/logs');
const qrInspectionsRoutes = require('./routes/qr-inspections');
const systemConfigRoutes = require('./routes/system-config');

// ログ設定(共有ロガー)
const logger = require('./lib/logger');

// データベース接続設定(共有プール)
const pool = require('./lib/db');

// Express アプリケーション設定
const app = express();
const PORT = process.env.PORT || 3001;

const m365AuthConfig = {
    enabled: process.env.M365_AUTH_ENABLED === 'true' &&
        Boolean(process.env.M365_AUTH_TENANT_ID) &&
        Boolean(process.env.M365_AUTH_CLIENT_ID),
    required: process.env.M365_AUTH_REQUIRED === 'true',
    tenantId: process.env.M365_AUTH_TENANT_ID || '',
    clientId: process.env.M365_AUTH_CLIENT_ID || '',
    scopes: (process.env.M365_AUTH_SCOPES || 'User.Read')
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    allowedDomains: (process.env.M365_AUTH_ALLOWED_DOMAINS || '')
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean)
};

const graphTokenCache = new Map();

function getBearerToken(req) {
    const auth = req.get('Authorization') || '';
    if (!auth.toLowerCase().startsWith('bearer ')) {
        return '';
    }
    return auth.slice(7).trim();
}

function getTokenCacheKey(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeGraphUser(user) {
    return {
        id: user.id,
        displayName: user.displayName,
        mail: user.mail || user.userPrincipalName || '',
        userPrincipalName: user.userPrincipalName || '',
        jobTitle: user.jobTitle || '',
        officeLocation: user.officeLocation || ''
    };
}

function isAllowedM365User(user) {
    if (!m365AuthConfig.allowedDomains.length) {
        return true;
    }
    const address = String(user.mail || user.userPrincipalName || '').toLowerCase();
    const domain = address.includes('@') ? address.split('@').pop() : '';
    return m365AuthConfig.allowedDomains.includes(domain);
}

async function validateM365Token(token) {
    if (!token) {
        return null;
    }

    const cacheKey = getTokenCacheKey(token);
    const cached = graphTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.user;
    }

    const response = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,jobTitle,officeLocation', {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
        logger.warn('M365 token validation failed', { status: response.status });
        return null;
    }

    const user = normalizeGraphUser(await response.json());
    if (!isAllowedM365User(user)) {
        logger.warn('M365 user rejected by allowed domain policy', {
            userPrincipalName: user.userPrincipalName,
            mail: user.mail
        });
        return null;
    }

    graphTokenCache.set(cacheKey, {
        user,
        expiresAt: Date.now() + 60 * 1000
    });
    return user;
}

// 管理者専用エンドポイント保護ミドルウェア
// 危険なエンドポイント(/database/*, /logs/*, sample-data)を保護する。
// M365認証が有効な場合はM365ユーザー(allowedDomains適用済み)を要求し、
// 無効な場合はADMIN_API_TOKEN(x-admin-token ヘッダ)で保護する。
// どちらも未設定の場合は安全側に倒して 403 で拒否する(既定オフ)。
async function requireAdmin(req, res, next) {
    try {
        if (m365AuthConfig.enabled) {
            const user = await validateM365Token(getBearerToken(req));
            if (!user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            req.user = user;
            return next();
        }
        const adminToken = process.env.ADMIN_API_TOKEN || '';
        if (adminToken) {
            const provided = req.get('x-admin-token') || '';
            // 長さ非依存の定数時間比較
            const a = Buffer.from(provided);
            const b = Buffer.from(adminToken);
            if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
                return next();
            }
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // 認証手段が未設定 → 危険エンドポイントは既定で無効
        logger.warn('Admin endpoint blocked: no M365 auth and no ADMIN_API_TOKEN configured', {
            path: req.originalUrl
        });
        return res.status(403).json({ error: 'This endpoint is disabled (no admin auth configured)' });
    } catch (err) {
        logger.error('requireAdmin error', { err: err.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// システム設定(共有・可変)
const systemConfig = require('./lib/config');

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
app.use(express.urlencoded({ extended: true }));

// レート制限（プロキシ対応）
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 100, // リクエスト数制限
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

// 更新系(POST/PUT/PATCH/DELETE)への認証 段階導入ミドルウェア
// WRITE_AUTH_MODE で挙動を切り替える(既定 off = POC の書き込みを維持):
//   off     : 認証チェックなし(従来通り)
//   warn    : トークンがあれば検証して req.user に載せる。なくても通すが warn ログを出す(移行観察用)
//   enforce : 有効な認証(M365トークン or ADMIN_API_TOKEN)がなければ 401(本番想定)
// 認証手段: M365 有効時は Bearer トークン、無効時は x-admin-token(ADMIN_API_TOKEN)。
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// 認証不要の更新系エンドポイント(存在すればここに追加。現状なし)
const WRITE_AUTH_EXEMPT = [];

async function resolveAuthenticatedUser(req) {
    if (m365AuthConfig.enabled) {
        const user = await validateM365Token(getBearerToken(req));
        return user || null;
    }
    const adminToken = process.env.ADMIN_API_TOKEN || '';
    if (adminToken) {
        const provided = req.get('x-admin-token') || '';
        const a = Buffer.from(provided);
        const b = Buffer.from(adminToken);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
            return { id: 'admin-token', displayName: 'Admin (token)' };
        }
    }
    return null;
}

app.use(async (req, res, next) => {
    if (!WRITE_METHODS.has(req.method)) return next();
    const mode = (process.env.WRITE_AUTH_MODE || 'off').toLowerCase();
    if (mode === 'off') return next();
    if (WRITE_AUTH_EXEMPT.some(p => req.path.startsWith(p))) return next();
    try {
        const user = await resolveAuthenticatedUser(req);
        if (user) {
            req.user = user;
            return next();
        }
        if (mode === 'warn') {
            logger.warn('Unauthenticated write (warn mode)', { method: req.method, path: req.path, ip: req.ip });
            return next();
        }
        // enforce
        return res.status(401).json({ error: 'Unauthorized' });
    } catch (err) {
        logger.error('write-auth middleware error', { err: err.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ヘルスチェック
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

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

app.use(async (req, res, next) => {
    if (!m365AuthConfig.enabled || !m365AuthConfig.required) {
        return next();
    }
    if (req.method === 'OPTIONS' || req.path === '/health' || req.path.startsWith('/auth/m365/')) {
        return next();
    }

    try {
        const user = await validateM365Token(getBearerToken(req));
        if (!user) {
            return res.status(401).json({ error: 'M365 sign-in is required' });
        }
        req.m365User = user;
        return next();
    } catch (error) {
        logger.error('M365 authentication middleware error:', error);
        return res.status(502).json({ error: 'Microsoft Graph validation failed' });
    }
});

// === OCR API（AWS Textract） ===
app.use('/api/ocr-ai', ocrAiRoutes);
app.use('/api/ocr-feedback', ocrFeedbackRoutes);
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
app.use('/api/ocr-ai', ocrAiRoutes);
app.use('/api/ocr-feedback', ocrFeedbackRoutes);

// データベース接続テスト
app.get('/db-test', async (req, res) => {
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

// === 製品関連API ===

// バリデーションスキーマ
const productSchema = Joi.object({
    product_code: Joi.string().max(50).required(),
    product_name: Joi.string().max(255).required(),
    description: Joi.string().allow('', null),
    unit_price: Joi.number().min(0).allow(null),
    category: Joi.string().max(100).allow('', null)
});

// 製品一覧取得
app.get('/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, i.current_stock, i.available_stock 
            FROM products p 
            LEFT JOIN inventory i ON p.id = i.product_id 
            ORDER BY p.product_code
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品詳細取得
app.get('/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT p.*, i.current_stock, i.available_stock, i.location 
            FROM products p 
            LEFT JOIN inventory i ON p.id = i.product_id 
            WHERE p.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品登録
app.post('/products', async (req, res) => {
    try {
        const { error, value } = productSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { product_code, product_name, description, unit_price, category } = value;

        // 製品コードの重複チェック
        const existingProduct = await pool.query(
            'SELECT id FROM products WHERE product_code = $1',
            [product_code]
        );

        if (existingProduct.rows.length > 0) {
            return res.status(409).json({ error: '製品コードが既に存在します' });
        }

        // トランザクション開始
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 製品を登録
            const productResult = await client.query(`
                INSERT INTO products (product_code, product_name, description, unit_price, category)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            `, [product_code, product_name, description, unit_price, category]);

            const newProduct = productResult.rows[0];

            // 在庫レコードを初期化
            await client.query(`
                INSERT INTO inventory (product_id, current_stock, reserved_stock)
                VALUES ($1, 0, 0)
            `, [newProduct.id]);

            await client.query('COMMIT');

            logger.info('Product created:', newProduct);
            res.status(201).json(newProduct);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error creating product:', error);
        if (error.code === '23505') { // Unique violation
            res.status(409).json({ error: '製品コードが既に存在します' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// 製品更新
app.put('/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = productSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { product_code, product_name, description, unit_price, category } = value;

        // 製品コードの重複チェック（自分以外）
        const existingProduct = await pool.query(
            'SELECT id FROM products WHERE product_code = $1 AND id != $2',
            [product_code, id]
        );

        if (existingProduct.rows.length > 0) {
            return res.status(409).json({ error: '製品コードが既に存在します' });
        }

        const result = await pool.query(`
            UPDATE products 
            SET product_code = $1,
                product_name = $2,
                description = $3,
                unit_price = $4,
                category = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *
        `, [product_code, product_name, description, unit_price, category, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        logger.info('Product updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating product:', error);
        if (error.code === '23505') { // Unique violation
            res.status(409).json({ error: '製品コードが既に存在します' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// 製品削除
app.delete('/products/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 削除前にリレーションチェック
        const relatedRecords = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM production_plans WHERE product_id = $1) as production_plans,
                (SELECT COUNT(*) FROM production_records WHERE product_id = $1) as production_records,
                (SELECT COUNT(*) FROM shipping_instructions WHERE product_id = $1) as shipping_instructions,
                (SELECT COUNT(*) FROM product_components WHERE product_id = $1) as product_components
        `, [id]);

        const relations = relatedRecords.rows[0];
        const hasRelations = Object.values(relations).some(count => parseInt(count) > 0);

        if (hasRelations) {
            return res.status(409).json({
                error: '関連データが存在するため削除できません',
                relations: relations
            });
        }

        // トランザクション開始
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 在庫レコードを削除
            await client.query('DELETE FROM inventory WHERE product_id = $1', [id]);

            // 製品を削除
            const result = await client.query(
                'DELETE FROM products WHERE id = $1 RETURNING *',
                [id]
            );

            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Product not found' });
            }

            await client.query('COMMIT');

            logger.info('Product deleted:', result.rows[0]);
            res.json({ message: 'Product deleted successfully', data: result.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error deleting product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 生産計画API ===

// 生産計画一覧取得
// production-plans API はルーターへ分離(routes/production-plans.js)
// shipping-locations API はルーターへ分離(routes/shipping-locations.js)
// delivery-locations API はルーターへ分離(routes/delivery-locations.js)
app.get('/shipping-instructions', async (req, res) => {
    try {
        const {
            status,
            priority,
            shipping_location,
            delivery_location,
            shipping_date_from,
            shipping_date_to,
            instruction_id
        } = req.query;

        let query = `
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name as shipping_location_name,
                   sl.location_code as shipping_location_code,
                   dl.location_name as delivery_location_name,
                   dl.location_code as delivery_location_code,
                   dl.address as delivery_address,
                   dl.phone as delivery_phone
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            LEFT JOIN delivery_locations dl ON si.delivery_location_id = dl.id
        `;
        const params = [];
        const conditions = [];

        if (status) {
            conditions.push('si.status = $' + (params.length + 1));
            params.push(status);
        }

        if (priority) {
            conditions.push('si.priority = $' + (params.length + 1));
            params.push(priority);
        }

        if (shipping_location) {
            conditions.push('sl.location_code = $' + (params.length + 1));
            params.push(shipping_location);
        }

        if (delivery_location) {
            conditions.push('dl.location_code = $' + (params.length + 1));
            params.push(delivery_location);
        }

        if (instruction_id) {
            conditions.push('si.instruction_id ILIKE $' + (params.length + 1));
            params.push(`%${instruction_id}%`);
        }

        if (shipping_date_from) {
            conditions.push('si.shipping_date >= $' + (params.length + 1));
            params.push(shipping_date_from);
        }

        if (shipping_date_to) {
            conditions.push('si.shipping_date <= $' + (params.length + 1));
            params.push(shipping_date_to);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY si.instruction_id ASC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping instructions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/shipping-instructions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name as shipping_location_name,
                   sl.location_code as shipping_location_code,
                   sl.address as shipping_address,
                   dl.location_name as delivery_location_name,
                   dl.location_code as delivery_location_code,
                   dl.address as delivery_address,
                   dl.phone as delivery_phone,
                   dl.contact_person as delivery_contact
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            LEFT JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            WHERE si.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching shipping instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示登録
app.post('/shipping-instructions', async (req, res) => {
    try {
        const {
            instruction_id,
            product_id,
            quantity,
            shipping_date,
            shipping_location_id,
            delivery_location_id,
            customer_name,
            priority,
            status,
            tracking_number,
            notes
        } = req.body;

        // バリデーション
        if (!instruction_id || !product_id || !quantity) {
            return res.status(400).json({
                error: 'Instruction ID, product ID, and quantity are required'
            });
        }

        if (quantity <= 0) {
            return res.status(400).json({
                error: 'Quantity must be greater than 0'
            });
        }

        const result = await pool.query(`
            INSERT INTO shipping_instructions
            (instruction_id, product_id, quantity, shipping_date,
             shipping_location_id, delivery_location_id, customer_name,
             priority, status, tracking_number, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            instruction_id,
            product_id,
            quantity,
            shipping_date || null,
            shipping_location_id || null,
            delivery_location_id || null,
            customer_name || null,
            priority || 'normal',
            status || 'pending',
            tracking_number || null,
            notes || null
        ]);

        logger.info('Shipping instruction created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating shipping instruction:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Instruction ID already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Invalid product, shipping location, or delivery location ID' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示更新
app.put('/shipping-instructions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            instruction_id,
            product_id,
            quantity,
            shipping_date,
            shipping_location_id,
            delivery_location_id,
            customer_name,
            priority,
            status,
            tracking_number,
            notes
        } = req.body;

        // バリデーション
        if (!instruction_id || !product_id || !quantity) {
            return res.status(400).json({
                error: 'Instruction ID, product ID, and quantity are required'
            });
        }

        if (quantity <= 0) {
            return res.status(400).json({
                error: 'Quantity must be greater than 0'
            });
        }

        const result = await pool.query(`
            UPDATE shipping_instructions
            SET instruction_id = $1, product_id = $2, quantity = $3,
                shipping_date = $4, shipping_location_id = $5,
                delivery_location_id = $6, customer_name = $7,
                priority = $8, status = $9, tracking_number = $10,
                notes = $11, updated_at = CURRENT_TIMESTAMP
            WHERE id = $12
            RETURNING *
        `, [
            instruction_id,
            product_id,
            quantity,
            shipping_date || null,
            shipping_location_id || null,
            delivery_location_id || null,
            customer_name || null,
            priority || 'normal',
            status || 'pending',
            tracking_number || null,
            notes || null,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        logger.info('Shipping instruction updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating shipping instruction:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Instruction ID already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Invalid product, shipping location, or delivery location ID' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示削除
app.delete('/shipping-instructions/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 関連する検品データの確認
        const relatedRecords = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM shipping_inspections WHERE shipping_instruction_id = $1) as shipping_inspections,
                (SELECT COUNT(*) FROM qr_inspections WHERE shipping_instruction_id = $1) as qr_inspections
        `, [id]);

        const relations = relatedRecords.rows[0];
        const hasRelations = Object.values(relations).some(count => parseInt(count) > 0);

        if (hasRelations) {
            return res.status(409).json({
                error: '関連する検品データが存在するため削除できません',
                relations: relations
            });
        }

        const result = await pool.query(
            'DELETE FROM shipping_instructions WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        logger.info('Shipping instruction deleted:', result.rows[0]);
        res.json({ message: 'Shipping instruction deleted successfully' });
    } catch (error) {
        logger.error('Error deleting shipping instruction:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: shipping instruction is referenced by other records' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 納入場所別サマリー取得
app.get('/shipping-instructions/summary/by-delivery-location', async (req, res) => {
    try {
        const {
            shipping_location,
            delivery_location,
            shipping_date_from,
            shipping_date_to,
            instruction_id
        } = req.query;

        let query = `
            SELECT 
                dl.location_code,
                dl.location_name,
                dl.address,
                dl.phone,
                dl.contact_person,
                dl.delivery_method,
                COUNT(si.id) as total_items,
                SUM(si.quantity) as total_quantity,
                SUM(CASE WHEN si.status = 'delivered' THEN 1 ELSE 0 END) as completed_items,
                SUM(CASE WHEN si.status = 'pending' THEN 1 ELSE 0 END) as pending_items,
                SUM(CASE WHEN si.status = 'processing' THEN 1 ELSE 0 END) as processing_items,
                SUM(CASE WHEN si.status = 'shipped' THEN 1 ELSE 0 END) as shipped_items,
                MIN(si.shipping_date) as earliest_shipping_date,
                MAX(si.shipping_date) as latest_shipping_date
            FROM delivery_locations dl
            LEFT JOIN shipping_instructions si ON dl.id = si.delivery_location_id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
        `;
        const params = [];
        const conditions = [];

        if (shipping_location) {
            conditions.push('sl.location_code = $' + (params.length + 1));
            params.push(shipping_location);
        }

        if (delivery_location) {
            conditions.push('dl.location_code = $' + (params.length + 1));
            params.push(delivery_location);
        }

        if (instruction_id) {
            conditions.push('si.instruction_id ILIKE $' + (params.length + 1));
            params.push(`%${instruction_id}%`);
        }

        if (shipping_date_from) {
            conditions.push('si.shipping_date >= $' + (params.length + 1));
            params.push(shipping_date_from);
        }

        if (shipping_date_to) {
            conditions.push('si.shipping_date <= $' + (params.length + 1));
            params.push(shipping_date_to);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += `
            GROUP BY dl.id, dl.location_code, dl.location_name, dl.address, dl.phone, dl.contact_person, dl.delivery_method
            HAVING COUNT(si.id) > 0
            ORDER BY dl.location_name
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching delivery location summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 納入場所詳細（品目リスト）取得
app.get('/shipping-instructions/detail/:deliveryLocationCode', async (req, res) => {
    try {
        const { deliveryLocationCode } = req.params;
        const {
            shipping_location,
            shipping_date_from,
            shipping_date_to,
            instruction_id
        } = req.query;

        let query = `
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name as shipping_location_name,
                   sl.location_code as shipping_location_code,
                   dl.location_name as delivery_location_name,
                   dl.location_code as delivery_location_code,
                   dl.address as delivery_address,
                   dl.phone as delivery_phone,
                   dl.contact_person as delivery_contact
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            WHERE dl.location_code = $1
        `;
        const params = [deliveryLocationCode];
        const conditions = [];

        if (shipping_location) {
            conditions.push('sl.location_code = $' + (params.length + 1));
            params.push(shipping_location);
        }

        if (instruction_id) {
            conditions.push('si.instruction_id ILIKE $' + (params.length + 1));
            params.push(`%${instruction_id}%`);
        }

        if (shipping_date_from) {
            conditions.push('si.shipping_date >= $' + (params.length + 1));
            params.push(shipping_date_from);
        }

        if (shipping_date_to) {
            conditions.push('si.shipping_date <= $' + (params.length + 1));
            params.push(shipping_date_to);
        }

        if (conditions.length > 0) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += ' ORDER BY si.shipping_date ASC, si.created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching delivery location detail:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 単一出荷指示の詳細取得
app.get('/shipping-instructions/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name as shipping_location_name,
                   sl.location_code as shipping_location_code,
                   dl.location_name as delivery_location_name,
                   dl.location_code as delivery_location_code,
                   dl.address as delivery_address,
                   dl.phone as delivery_phone,
                   dl.contact_person as delivery_contact,
                   dl.delivery_method
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            WHERE si.id = $1
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching shipping instruction detail:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ピッキング情報の更新
app.patch('/shipping-instructions/:id/picking', async (req, res) => {
    try {
        const { id } = req.params;
        const { picked_quantity, notes } = req.body;

        // バリデーション
        if (picked_quantity !== undefined && (picked_quantity < 0 || !Number.isInteger(picked_quantity))) {
            return res.status(400).json({ error: 'Invalid picked_quantity' });
        }

        const query = `
            UPDATE shipping_instructions 
            SET picked_quantity = $1,
                picking_notes = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `;

        const result = await pool.query(query, [picked_quantity, notes, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        res.json({ message: 'Picking information updated successfully', data: result.rows[0] });
    } catch (error) {
        logger.error('Error updating picking information:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 出荷検品関連API ===
app.get('/shipping-inspections', async (req, res) => {
    try {
        const { shipping_instruction_id } = req.query;
        let query = `
            SELECT shi.*, si.instruction_id, p.product_code, p.product_name
            FROM shipping_inspections shi
            JOIN shipping_instructions si ON shi.shipping_instruction_id = si.id
            JOIN products p ON si.product_id = p.id
        `;
        const params = [];

        if (shipping_instruction_id) {
            query += ' WHERE shi.shipping_instruction_id = $1';
            params.push(shipping_instruction_id);
        }

        query += ' ORDER BY shi.inspection_date DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping inspections:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 製品構成部品API ===

// 製品構成部品一覧取得（全件）
// product-components API はルーターへ分離(routes/product-components.js)
app.get('/products/:productId/components', async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await pool.query(`
            SELECT pc.*, p.product_code, p.product_name
            FROM product_components pc
            JOIN products p ON pc.product_id = p.id
            WHERE pc.product_id = $1
            ORDER BY 
                CASE pc.component_type 
                    WHEN 'main' THEN 1 
                    WHEN 'accessory' THEN 2 
                    WHEN 'manual' THEN 3 
                    WHEN 'warranty' THEN 4 
                    ELSE 5 
                END, pc.component_name
        `, [productId]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching product components:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示IDから製品同梱物取得
app.get('/shipping-instructions/:id/components', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT pc.*, p.product_code, p.product_name, si.quantity, si.instruction_id,
                   i.current_stock, i.available_stock
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            JOIN product_components pc ON p.id = pc.product_id
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE si.id = $1
            ORDER BY 
                CASE pc.component_type 
                    WHEN 'main' THEN 1 
                    WHEN 'accessory' THEN 2 
                    WHEN 'manual' THEN 3 
                    WHEN 'warranty' THEN 4 
                    ELSE 5 
                END, pc.component_name
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction or components not found' });
        }

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping instruction components:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR検品開始
// qr-inspections API はルーターへ分離(routes/qr-inspections.js)
app.get('/shipping-instructions/:id/qr-inspection-data', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. 出荷指示詳細を取得
        const shippingResult = await pool.query(`
            SELECT
                si.id,
                si.instruction_id,
                si.quantity,
                si.shipping_date,
                si.customer_name,
                si.priority,
                si.status,
                si.notes,
                p.id as product_id,
                p.product_code,
                p.product_name,
                p.description as product_description,
                sl.location_name as shipping_location_name,
                sl.address as shipping_location_address,
                dl.location_name as delivery_location_name,
                dl.address as delivery_location_address
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            LEFT JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            WHERE si.id = $1
        `, [id]);

        if (shippingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        const shipping = shippingResult.rows[0];

        // 2. 製品構成部品を取得
        const componentsResult = await pool.query(`
            SELECT
                pc.id,
                pc.component_type,
                pc.component_name,
                pc.qr_code,
                pc.is_required
            FROM product_components pc
            WHERE pc.product_id = $1
            ORDER BY
                CASE pc.component_type
                    WHEN 'main' THEN 1
                    WHEN 'accessory' THEN 2
                    WHEN 'documentation' THEN 3
                    WHEN 'packaging' THEN 4
                    ELSE 5
                END,
                pc.id
        `, [shipping.product_id]);

        // 3. 在庫情報を取得
        let inventory = null;
        try {
            const inventoryResult = await pool.query(`
                SELECT
                    i.id,
                    i.product_id,
                    i.current_stock,
                    i.reserved_stock,
                    i.available_stock,
                    i.location,
                    i.last_updated
                FROM inventory i
                WHERE i.product_id = $1
                LIMIT 1
            `, [shipping.product_id]);

            if (inventoryResult.rows.length > 0) {
                inventory = inventoryResult.rows[0];
            }
        } catch (err) {
            // 在庫テーブルがない場合はスキップ
            logger.warn('Inventory table not found or query failed:', err.message);
        }

        // 4. 既存の検品レコードを確認（進行中のものがあれば）
        const existingInspectionResult = await pool.query(`
            SELECT
                qi.id,
                qi.status,
                qi.inspector_name,
                qi.created_at
            FROM qr_inspections qi
            WHERE qi.shipping_instruction_id = $1
              AND qi.status = 'in_progress'
            ORDER BY qi.created_at DESC
            LIMIT 1
        `, [id]);

        const existingInspection = existingInspectionResult.rows.length > 0
            ? existingInspectionResult.rows[0]
            : null;

        // 5. 既存の検品セッションがある場合、スキャン済みアイテムを取得
        let scannedQRCodes = [];
        if (existingInspection) {
            const scannedResult = await pool.query(`
                SELECT DISTINCT qid.qr_code
                FROM qr_inspection_details qid
                WHERE qid.qr_inspection_id = $1
                  AND qid.status = 'scanned'
            `, [existingInspection.id]);

            scannedQRCodes = scannedResult.rows.map(row => row.qr_code);
        }

        // 6. レスポンスを返す
        res.json({
            shipping: shipping,
            components: componentsResult.rows,
            inventory: inventory,
            existingInspection: existingInspection,
            scannedQRCodes: scannedQRCodes
        });

    } catch (error) {
        logger.error('Error fetching QR inspection data:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

// === 検品者マスタ CRUD API ===

// 検品者一覧取得
// inspectors API はルーターへ分離(routes/inspectors.js)
app.post('/shipping-instructions', async (req, res) => {
    try {
        const { error, value } = shippingInstructionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            instruction_id,
            product_id,
            quantity,
            shipping_date,
            shipping_location_id,
            delivery_location_id,
            customer_name,
            priority,
            status,
            tracking_number,
            notes
        } = value;

        // instruction_idの重複チェック
        const duplicateCheck = await pool.query(
            'SELECT id FROM shipping_instructions WHERE instruction_id = $1',
            [instruction_id]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({ error: '出荷指示IDが既に存在します' });
        }

        const result = await pool.query(`
            INSERT INTO shipping_instructions (
                instruction_id, product_id, quantity, shipping_date,
                shipping_location_id, delivery_location_id, customer_name,
                priority, status, tracking_number, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            instruction_id, product_id, quantity, shipping_date,
            shipping_location_id, delivery_location_id, customer_name,
            priority, status, tracking_number, notes
        ]);

        logger.info('Shipping instruction created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating shipping instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示更新
app.put('/shipping-instructions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = shippingInstructionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            instruction_id,
            product_id,
            quantity,
            shipping_date,
            shipping_location_id,
            delivery_location_id,
            customer_name,
            priority,
            status,
            tracking_number,
            notes
        } = value;

        // instruction_idの重複チェック（自分以外）
        const duplicateCheck = await pool.query(
            'SELECT id FROM shipping_instructions WHERE instruction_id = $1 AND id != $2',
            [instruction_id, id]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({ error: '出荷指示IDが既に存在します' });
        }

        const result = await pool.query(`
            UPDATE shipping_instructions
            SET instruction_id = $1,
                product_id = $2,
                quantity = $3,
                shipping_date = $4,
                shipping_location_id = $5,
                delivery_location_id = $6,
                customer_name = $7,
                priority = $8,
                status = $9,
                tracking_number = $10,
                notes = $11,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $12
            RETURNING *
        `, [
            instruction_id, product_id, quantity, shipping_date,
            shipping_location_id, delivery_location_id, customer_name,
            priority, status, tracking_number, notes, id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        logger.info('Shipping instruction updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating shipping instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示削除
app.delete('/shipping-instructions/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 関連する検品記録があるかチェック
        const inspectionCheck = await pool.query(
            'SELECT id FROM shipping_inspections WHERE shipping_instruction_id = $1',
            [id]
        );

        if (inspectionCheck.rows.length > 0) {
            return res.status(409).json({
                error: '検品記録が存在するため削除できません',
                details: '先に検品記録を削除してください'
            });
        }

        // QR検品記録があるかチェック
        const qrInspectionCheck = await pool.query(
            'SELECT id FROM qr_inspections WHERE shipping_instruction_id = $1',
            [id]
        );

        if (qrInspectionCheck.rows.length > 0) {
            return res.status(409).json({
                error: 'QR検品記録が存在するため削除できません',
                details: '先にQR検品記録を削除してください'
            });
        }

        const result = await pool.query(
            'DELETE FROM shipping_instructions WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        logger.info('Shipping instruction deleted:', result.rows[0]);
        res.json({ message: 'Shipping instruction deleted successfully', data: result.rows[0] });
    } catch (error) {
        logger.error('Error deleting shipping instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷検品記録の作成
const shippingInspectionSchema = Joi.object({
    shipping_instruction_id: Joi.number().required(),
    inspector_name: Joi.string().max(100).required(),
    inspected_quantity: Joi.number().min(0).required(),
    passed_quantity: Joi.number().min(0).required(),
    failed_quantity: Joi.number().min(0).default(0),
    defect_details: Joi.string().allow(''),
    packaging_condition: Joi.string().max(50),
    label_check: Joi.boolean().default(false),
    documentation_check: Joi.boolean().default(false),
    final_approval: Joi.boolean().default(false),
    notes: Joi.string().allow('')
});

app.post('/shipping-inspections', async (req, res) => {
    try {
        const { error, value } = shippingInspectionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            shipping_instruction_id,
            inspector_name,
            inspected_quantity,
            passed_quantity,
            failed_quantity,
            defect_details,
            packaging_condition,
            label_check,
            documentation_check,
            final_approval,
            notes
        } = value;

        const result = await pool.query(`
            INSERT INTO shipping_inspections (
                shipping_instruction_id, inspector_name, inspected_quantity,
                passed_quantity, failed_quantity, defect_details,
                packaging_condition, label_check, documentation_check,
                final_approval, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            shipping_instruction_id, inspector_name, inspected_quantity,
            passed_quantity, failed_quantity, defect_details,
            packaging_condition, label_check, documentation_check,
            final_approval, notes
        ]);

        // 最終承認の場合、出荷指示のステータスを更新
        if (final_approval && passed_quantity === inspected_quantity) {
            await pool.query(`
                UPDATE shipping_instructions 
                SET status = 'processing' 
                WHERE id = $1
            `, [shipping_instruction_id]);
        }

        logger.info('Shipping inspection created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating shipping inspection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === レポート関連API ===
// レポート API はルーターへ分離(routes/reports.js)

// === QC七つ道具API ===

// パレート図データ
// QC七つ道具 API はルーターへ分離(routes/qc-tools.js)
// inventory API はルーターへ分離(routes/inventory.js)
app.get('/database/stats', requireAdmin, async (req, res) => {
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
app.post('/database/backup', requireAdmin, async (req, res) => {
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
app.get('/database/backups', requireAdmin, async (req, res) => {
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
app.get('/database/backup', requireAdmin, async (req, res) => {
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
app.post('/database/restore', requireAdmin, async (req, res) => {
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
app.get('/shipping-instructions/:id/pps-status', async (req, res) => {
    try {
        const { id } = req.params;
        const si = await pool.query(`
            SELECT si.*, p.product_code, p.product_name
            FROM shipping_instructions si JOIN products p ON si.product_id = p.id
            WHERE si.id = $1
        `, [id]);
        if (si.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        const picking = await pool.query(
            `SELECT pi.*, json_agg(pr.*) as records
             FROM picking_instructions pi
             LEFT JOIN picking_records pr ON pi.id = pr.picking_instruction_id
             WHERE pi.shipping_instruction_id = $1
             GROUP BY pi.id ORDER BY pi.created_at DESC LIMIT 1`, [id]
        );
        const packing = await pool.query(
            `SELECT * FROM packing_records WHERE shipping_instruction_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]
        );
        const qrInspection = await pool.query(
            `SELECT qi.*, json_agg(qid.*) as details
             FROM qr_inspections qi
             LEFT JOIN qr_inspection_details qid ON qi.id = qid.qr_inspection_id
             WHERE qi.shipping_instruction_id = $1
             GROUP BY qi.id ORDER BY qi.created_at DESC LIMIT 1`, [id]
        );
        const lotInfo = await pool.query(
            `SELECT li.* FROM lot_inventory li WHERE li.product_id = $1 AND li.status='available' ORDER BY li.lot_number`,
            [si.rows[0].product_id]
        );

        res.json({
            shipping: si.rows[0],
            picking: picking.rows[0] || null,
            packing: packing.rows[0] || null,
            qr_inspection: qrInspection.rows[0] || null,
            available_lots: lotInfo.rows
        });
    } catch (error) {
        logger.error('Error fetching PPS status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// エラーハンドリング
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
