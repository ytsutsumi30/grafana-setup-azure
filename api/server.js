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

// ログ設定
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// データベース接続設定
const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'production_db',
    user: process.env.DB_USER || 'production_user',
    password: process.env.DB_PASSWORD || 'production_pass',
    // SSL設定: 環境変数で制御（ローカルPostgreSQLではSSL無効）
    ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false // RDS自己署名証明書対応
    } : false
});

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

// システム設定（POC用）
let systemConfig = {
    pocMode: true,  // POCモード: true = DB書き込み抑止, false = 通常動作
    enableQRInspectionDB: false,  // QR検品のDB書き込み: false = 抑止, true = 有効
    lastUpdated: new Date().toISOString()
};

// プロキシ信頼設定（nginxリバースプロキシ対応）
app.set('trust proxy', 1);

// ミドルウェア設定
app.use(helmet());
app.use(cors());
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
app.get('/production-plans', async (req, res) => {
    try {
        const { status } = req.query;

        let query = `
            SELECT pp.*, p.product_code, p.product_name
            FROM production_plans pp
            JOIN products p ON pp.product_id = p.id
        `;
        const params = [];

        if (status) {
            query += ' WHERE pp.status = $1';
            params.push(status);
        }

        query += ' ORDER BY pp.planned_start_date DESC, pp.created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching production plans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 生産計画詳細取得
app.get('/production-plans/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT pp.*, p.product_code, p.product_name
            FROM production_plans pp
            JOIN products p ON pp.product_id = p.id
            WHERE pp.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Production plan not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching production plan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 生産計画登録
app.post('/production-plans', async (req, res) => {
    try {
        const {
            plan_id,
            product_id,
            planned_quantity,
            planned_start_date,
            planned_end_date,
            status
        } = req.body;

        // バリデーション
        if (!plan_id || !product_id || !planned_quantity) {
            return res.status(400).json({
                error: 'Plan ID, product ID, and planned quantity are required'
            });
        }

        if (planned_quantity <= 0) {
            return res.status(400).json({
                error: 'Planned quantity must be greater than 0'
            });
        }

        // 日付の妥当性チェック
        if (planned_start_date && planned_end_date) {
            const startDate = new Date(planned_start_date);
            const endDate = new Date(planned_end_date);
            if (endDate < startDate) {
                return res.status(400).json({
                    error: 'End date must be after start date'
                });
            }
        }

        const result = await pool.query(`
            INSERT INTO production_plans
            (plan_id, product_id, planned_quantity, planned_start_date, planned_end_date, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            plan_id,
            product_id,
            planned_quantity,
            planned_start_date || null,
            planned_end_date || null,
            status || 'planned'
        ]);

        logger.info('Production plan created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating production plan:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Plan ID already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Invalid product ID' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 生産計画更新
app.put('/production-plans/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            plan_id,
            product_id,
            planned_quantity,
            planned_start_date,
            planned_end_date,
            status
        } = req.body;

        // バリデーション
        if (!plan_id || !product_id || !planned_quantity) {
            return res.status(400).json({
                error: 'Plan ID, product ID, and planned quantity are required'
            });
        }

        if (planned_quantity <= 0) {
            return res.status(400).json({
                error: 'Planned quantity must be greater than 0'
            });
        }

        // 日付の妥当性チェック
        if (planned_start_date && planned_end_date) {
            const startDate = new Date(planned_start_date);
            const endDate = new Date(planned_end_date);
            if (endDate < startDate) {
                return res.status(400).json({
                    error: 'End date must be after start date'
                });
            }
        }

        const result = await pool.query(`
            UPDATE production_plans
            SET plan_id = $1, product_id = $2, planned_quantity = $3,
                planned_start_date = $4, planned_end_date = $5, status = $6,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
            RETURNING *
        `, [
            plan_id,
            product_id,
            planned_quantity,
            planned_start_date || null,
            planned_end_date || null,
            status || 'planned',
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Production plan not found' });
        }

        logger.info('Production plan updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating production plan:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Plan ID already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Invalid product ID' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 生産計画削除
app.delete('/production-plans/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 関連する生産実績の確認
        const relatedRecords = await pool.query(`
            SELECT COUNT(*) as count
            FROM production_records
            WHERE plan_id = $1
        `, [id]);

        const recordCount = parseInt(relatedRecords.rows[0].count);

        if (recordCount > 0) {
            return res.status(409).json({
                error: '関連する生産実績が存在するため削除できません',
                production_records: recordCount
            });
        }

        const result = await pool.query(
            'DELETE FROM production_plans WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Production plan not found' });
        }

        logger.info('Production plan deleted:', result.rows[0]);
        res.json({ message: 'Production plan deleted successfully' });
    } catch (error) {
        logger.error('Error deleting production plan:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: production plan is referenced by other records' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 出荷場所・納入場所API ===
app.get('/shipping-locations', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM shipping_locations 
            ORDER BY location_code
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping locations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷場所詳細取得
app.get('/shipping-locations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM shipping_locations WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping location not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching shipping location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷場所登録
app.post('/shipping-locations', async (req, res) => {
    try {
        const { location_code, location_name, address, phone, contact_person } = req.body;

        // バリデーション
        if (!location_code || !location_name) {
            return res.status(400).json({ error: 'Location code and name are required' });
        }

        const result = await pool.query(
            `INSERT INTO shipping_locations
             (location_code, location_name, address, phone, contact_person)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [location_code, location_name, address || null, phone || null, contact_person || null]
        );

        logger.info('Shipping location created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating shipping location:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Location code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷場所更新
app.put('/shipping-locations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { location_code, location_name, address, phone, contact_person } = req.body;

        // バリデーション
        if (!location_code || !location_name) {
            return res.status(400).json({ error: 'Location code and name are required' });
        }

        const result = await pool.query(
            `UPDATE shipping_locations
             SET location_code = $1, location_name = $2, address = $3,
                 phone = $4, contact_person = $5
             WHERE id = $6
             RETURNING *`,
            [location_code, location_name, address || null, phone || null, contact_person || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping location not found' });
        }

        logger.info('Shipping location updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating shipping location:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Location code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷場所削除
app.delete('/shipping-locations/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM shipping_locations WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping location not found' });
        }

        logger.info('Shipping location deleted:', result.rows[0]);
        res.json({ message: 'Shipping location deleted successfully' });
    } catch (error) {
        logger.error('Error deleting shipping location:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: location is referenced by shipping instructions' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/delivery-locations', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM delivery_locations
            ORDER BY location_code
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching delivery locations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 納入場所詳細取得
app.get('/delivery-locations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM delivery_locations WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Delivery location not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching delivery location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 納入場所登録
app.post('/delivery-locations', async (req, res) => {
    try {
        const { location_code, location_name, address, phone, contact_person, delivery_method } = req.body;

        // バリデーション
        if (!location_code || !location_name) {
            return res.status(400).json({ error: 'Location code and name are required' });
        }

        const result = await pool.query(
            `INSERT INTO delivery_locations
             (location_code, location_name, address, phone, contact_person, delivery_method)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [location_code, location_name, address || null, phone || null, contact_person || null, delivery_method || '宅配便']
        );

        logger.info('Delivery location created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating delivery location:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Location code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 納入場所更新
app.put('/delivery-locations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { location_code, location_name, address, phone, contact_person, delivery_method } = req.body;

        // バリデーション
        if (!location_code || !location_name) {
            return res.status(400).json({ error: 'Location code and name are required' });
        }

        const result = await pool.query(
            `UPDATE delivery_locations
             SET location_code = $1, location_name = $2, address = $3,
                 phone = $4, contact_person = $5, delivery_method = $6
             WHERE id = $7
             RETURNING *`,
            [location_code, location_name, address || null, phone || null, contact_person || null, delivery_method || '宅配便', id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Delivery location not found' });
        }

        logger.info('Delivery location updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating delivery location:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Location code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 納入場所削除
app.delete('/delivery-locations/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM delivery_locations WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Delivery location not found' });
        }

        logger.info('Delivery location deleted:', result.rows[0]);
        res.json({ message: 'Delivery location deleted successfully' });
    } catch (error) {
        logger.error('Error deleting delivery location:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: location is referenced by shipping instructions' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 出荷指示関連API ===
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
app.get('/product-components', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pc.*, p.product_code, p.product_name
            FROM product_components pc
            JOIN products p ON pc.product_id = p.id
            ORDER BY p.product_code,
                CASE pc.component_type
                    WHEN 'main' THEN 1
                    WHEN 'accessory' THEN 2
                    WHEN 'manual' THEN 3
                    WHEN 'warranty' THEN 4
                    ELSE 5
                END, pc.component_name
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching product components:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品構成部品詳細取得
app.get('/product-components/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT pc.*, p.product_code, p.product_name
            FROM product_components pc
            JOIN products p ON pc.product_id = p.id
            WHERE pc.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product component not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching product component:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品構成部品登録
app.post('/product-components', async (req, res) => {
    try {
        const { product_id, component_type, component_name, qr_code, is_required } = req.body;

        // バリデーション
        if (!product_id || !component_type || !component_name || !qr_code) {
            return res.status(400).json({
                error: 'Product ID, component type, name, and QR code are required'
            });
        }

        const result = await pool.query(`
            INSERT INTO product_components
            (product_id, component_type, component_name, qr_code, is_required)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [product_id, component_type, component_name, qr_code, is_required !== false]);

        logger.info('Product component created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating product component:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'QR code already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Product not found' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品構成部品更新
app.put('/product-components/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { product_id, component_type, component_name, qr_code, is_required } = req.body;

        // バリデーション
        if (!product_id || !component_type || !component_name || !qr_code) {
            return res.status(400).json({
                error: 'Product ID, component type, name, and QR code are required'
            });
        }

        const result = await pool.query(`
            UPDATE product_components
            SET product_id = $1, component_type = $2, component_name = $3,
                qr_code = $4, is_required = $5, updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *
        `, [product_id, component_type, component_name, qr_code, is_required !== false, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product component not found' });
        }

        logger.info('Product component updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating product component:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'QR code already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Product not found' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品構成部品削除
app.delete('/product-components/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM product_components WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product component not found' });
        }

        logger.info('Product component deleted:', result.rows[0]);
        res.json({ message: 'Product component deleted successfully' });
    } catch (error) {
        logger.error('Error deleting product component:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: component is referenced by inspection records' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === QR検品関連API ===

// 製品の同梱物一覧取得
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
app.post('/qr-inspections', async (req, res) => {
    try {
        const { shipping_instruction_id, inspector_name } = req.body;

        if (!shipping_instruction_id || !inspector_name) {
            return res.status(400).json({ error: 'shipping_instruction_id and inspector_name are required' });
        }

        // 出荷指示と製品情報を取得
        const shippingResult = await pool.query(`
            SELECT si.*, p.id as product_id, i.current_stock
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE si.id = $1
        `, [shipping_instruction_id]);

        if (shippingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        const shippingInstruction = shippingResult.rows[0];

        // 同梱物数を取得
        const componentsResult = await pool.query(`
            SELECT COUNT(*) as total_components
            FROM product_components
            WHERE product_id = $1 AND is_required = true
        `, [shippingInstruction.product_id]);

        const totalComponents = parseInt(componentsResult.rows[0].total_components);

        // QR検品記録を作成
        const result = await pool.query(`
            INSERT INTO qr_inspections (
                shipping_instruction_id, inspector_name, product_id,
                total_components, current_stock_before
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [
            shipping_instruction_id, inspector_name, shippingInstruction.product_id,
            totalComponents, shippingInstruction.current_stock
        ]);

        logger.info('QR inspection started:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error starting QR inspection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QRコードスキャン記録
app.post('/qr-inspections/:id/scan', async (req, res) => {
    try {
        const { id } = req.params;
        const { qr_code } = req.body;

        if (!qr_code) {
            return res.status(400).json({ error: 'qr_code is required' });
        }

        // QR検品記録を取得
        const inspectionResult = await pool.query(`
            SELECT * FROM qr_inspections WHERE id = $1 AND status = 'in_progress'
        `, [id]);

        if (inspectionResult.rows.length === 0) {
            return res.status(404).json({ error: 'QR inspection not found or already completed' });
        }

        const inspection = inspectionResult.rows[0];

        // 製品同梱物をチェック
        const componentResult = await pool.query(`
            SELECT * FROM product_components 
            WHERE product_id = $1 AND qr_code = $2
        `, [inspection.product_id, qr_code]);

        if (componentResult.rows.length === 0) {
            // 不正なQRコード
            const errorResult = await pool.query(`
                INSERT INTO qr_inspection_details (
                    qr_inspection_id, qr_code, status, error_message
                ) VALUES ($1, $2, 'error', 'Invalid QR code for this product')
                RETURNING *
            `, [id, qr_code]);

            return res.status(400).json({
                success: false,
                message: '対象外のQRコードです',
                data: errorResult.rows[0]
            });
        }

        const component = componentResult.rows[0];

        // POCモードチェック: DB書き込みが無効の場合
        if (systemConfig.pocMode && !systemConfig.enableQRInspectionDB) {
            logger.info(`[POC Mode] QR scan skipped DB write: ${qr_code}`);

            // DB書き込みなしでも成功レスポンスを返す
            return res.json({
                success: true,
                message: 'スキャン成功 (POCモード: DB書き込みなし)',
                component: component,
                pocMode: true
            });
        }

        // 既にスキャン済みかチェック
        const existingResult = await pool.query(`
            SELECT * FROM qr_inspection_details 
            WHERE qr_inspection_id = $1 AND product_component_id = $2 AND status = 'scanned'
        `, [id, component.id]);

        if (existingResult.rows.length > 0) {
            // 重複スキャン
            return res.status(400).json({
                success: false,
                message: '既にスキャン済みです',
                component: component
            });
        }

        // スキャン記録を追加
        const scanResult = await pool.query(`
            INSERT INTO qr_inspection_details (
                qr_inspection_id, product_component_id, qr_code, status
            ) VALUES ($1, $2, $3, 'scanned')
            RETURNING *
        `, [id, component.id, qr_code]);

        // スキャン済み数を更新
        await pool.query(`
            UPDATE qr_inspections 
            SET scanned_components = (
                SELECT COUNT(*) FROM qr_inspection_details 
                WHERE qr_inspection_id = $1 AND status = 'scanned'
            ),
            updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [id]);

        res.json({
            success: true,
            message: 'スキャン成功',
            component: component,
            data: scanResult.rows[0]
        });
    } catch (error) {
        logger.error('Error processing QR scan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR検品完了
app.patch('/qr-inspections/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        // POCモードチェック: DB書き込みが無効の場合
        if (systemConfig.pocMode && !systemConfig.enableQRInspectionDB) {
            logger.info(`[POC Mode] QR inspection complete skipped DB write: ${id}`);

            // DB書き込みなしで成功レスポンスを返す
            return res.json({
                id: id,
                status: 'completed',
                passed_quantity: 0,
                notes: notes || '検品完了 (POCモード: DB書き込みなし)',
                completed_at: new Date().toISOString(),
                pocMode: true,
                message: '検品完了しました（POCモード）'
            });
        }

        // QR検品記録を取得
        const inspectionResult = await pool.query(`
            SELECT qi.*, si.quantity 
            FROM qr_inspections qi
            JOIN shipping_instructions si ON qi.shipping_instruction_id = si.id
            WHERE qi.id = $1 AND qi.status = 'in_progress'
        `, [id]);

        if (inspectionResult.rows.length === 0) {
            return res.status(404).json({ error: 'QR inspection not found or already completed' });
        }

        const inspection = inspectionResult.rows[0];

        // 全同梱物がスキャン済みかチェック
        const isComplete = inspection.scanned_components >= inspection.total_components;
        const status = isComplete ? 'completed' : 'failed';
        const passedQuantity = isComplete ? inspection.quantity : 0;

        // 在庫を更新（検品合格の場合のみ）
        let newStock = inspection.current_stock_before;
        if (isComplete && passedQuantity > 0) {
            const stockResult = await pool.query(`
                UPDATE inventory 
                SET current_stock = current_stock - $1,
                    available_stock = available_stock - $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE product_id = $2
                RETURNING current_stock
            `, [passedQuantity, inspection.product_id]);

            newStock = stockResult.rows[0]?.current_stock || inspection.current_stock_before;
        }

        // QR検品記録を完了
        const result = await pool.query(`
            UPDATE qr_inspections 
            SET status = $1,
                passed_quantity = $2,
                current_stock_after = $3,
                notes = $4,
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `, [status, passedQuantity, newStock, notes, id]);

        // 検品完了の場合、出荷指示のステータスも更新
        if (isComplete) {
            await pool.query(`
                UPDATE shipping_instructions 
                SET status = 'processing',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [inspection.shipping_instruction_id]);
        }

        logger.info('QR inspection completed:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error completing QR inspection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR検品詳細取得
app.get('/qr-inspections/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // QR検品記録を取得
        const inspectionResult = await pool.query(`
            SELECT qi.*, si.instruction_id, si.quantity, p.product_code, p.product_name
            FROM qr_inspections qi
            JOIN shipping_instructions si ON qi.shipping_instruction_id = si.id
            JOIN products p ON qi.product_id = p.id
            WHERE qi.id = $1
        `, [id]);

        if (inspectionResult.rows.length === 0) {
            return res.status(404).json({ error: 'QR inspection not found' });
        }

        // 検品詳細を取得
        const detailsResult = await pool.query(`
            SELECT qid.*, pc.component_name, pc.component_type, pc.qr_code as expected_qr_code
            FROM qr_inspection_details qid
            LEFT JOIN product_components pc ON qid.product_component_id = pc.id
            WHERE qid.qr_inspection_id = $1
            ORDER BY qid.scanned_at DESC
        `, [id]);

        res.json({
            inspection: inspectionResult.rows[0],
            details: detailsResult.rows
        });
    } catch (error) {
        logger.error('Error fetching QR inspection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR検品用統合データ取得（出荷指示詳細+製品構成部品+在庫情報）
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
app.get('/inspectors', async (req, res) => {
    try {
        const { is_active } = req.query;

        let query = 'SELECT * FROM inspectors';
        const params = [];

        if (is_active !== undefined) {
            query += ' WHERE is_active = $1';
            params.push(is_active === 'true');
        }

        query += ' ORDER BY inspector_code';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inspectors:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品者詳細取得
app.get('/inspectors/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM inspectors WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inspector not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching inspector:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品者登録バリデーションスキーマ
const inspectorSchema = Joi.object({
    inspector_code: Joi.string().max(20).required(),
    inspector_name: Joi.string().max(100).required(),
    email: Joi.string().email().max(255).allow('', null),
    phone: Joi.string().max(20).allow('', null),
    department: Joi.string().max(100).allow('', null),
    role: Joi.string().valid('inspector', 'supervisor', 'admin').default('inspector'),
    is_active: Joi.boolean().default(true)
});

// 検品者登録
app.post('/inspectors', async (req, res) => {
    try {
        const { error, value } = inspectorSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            inspector_code,
            inspector_name,
            email,
            phone,
            department,
            role,
            is_active
        } = value;

        const result = await pool.query(`
            INSERT INTO inspectors (
                inspector_code, inspector_name, email, phone, department, role, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [inspector_code, inspector_name, email, phone, department, role, is_active]);

        logger.info('Inspector created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating inspector:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Inspector code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品者更新
app.put('/inspectors/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = inspectorSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            inspector_code,
            inspector_name,
            email,
            phone,
            department,
            role,
            is_active
        } = value;

        const result = await pool.query(`
            UPDATE inspectors
            SET inspector_code = $1,
                inspector_name = $2,
                email = $3,
                phone = $4,
                department = $5,
                role = $6,
                is_active = $7,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $8
            RETURNING *
        `, [inspector_code, inspector_name, email, phone, department, role, is_active, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inspector not found' });
        }

        logger.info('Inspector updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating inspector:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Inspector code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品者削除
app.delete('/inspectors/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM inspectors WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inspector not found' });
        }

        logger.info('Inspector deleted:', result.rows[0]);
        res.json({ message: 'Inspector deleted successfully', inspector: result.rows[0] });
    } catch (error) {
        logger.error('Error deleting inspector:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 出荷指示 CRUD API ===

// 出荷指示作成バリデーションスキーマ
const shippingInstructionSchema = Joi.object({
    instruction_id: Joi.string().max(50).required(),
    product_id: Joi.number().required(),
    quantity: Joi.number().min(1).required(),
    shipping_date: Joi.date().required(),
    shipping_location_id: Joi.number().required(),
    delivery_location_id: Joi.number().required(),
    customer_name: Joi.string().max(255).allow(''),
    priority: Joi.string().valid('high', 'normal', 'low').default('normal'),
    status: Joi.string().valid('pending', 'processing', 'shipped', 'delivered').default('pending'),
    tracking_number: Joi.string().max(100).allow(''),
    notes: Joi.string().allow('')
});

// 出荷指示作成
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
app.get('/reports/shipping-summary', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM shipping_inspection_summary
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/reports/dashboard-stats', async (req, res) => {
    try {
        const [
            shippingStats,
            inspectionStats,
            inventoryStats
        ] = await Promise.all([
            pool.query(`
                SELECT
                    status,
                    COUNT(*) as count
                FROM shipping_instructions
                GROUP BY status
            `),
            pool.query(`
                SELECT
                    COUNT(*) as total_inspections,
                    SUM(CASE WHEN final_approval THEN 1 ELSE 0 END) as approved_inspections,
                    AVG(passed_quantity::float / NULLIF(inspected_quantity, 0) * 100) as pass_rate
                FROM shipping_inspections
                WHERE inspection_date >= CURRENT_DATE - INTERVAL '30 days'
            `),
            pool.query(`
                SELECT
                    COUNT(*) as total_products,
                    SUM(current_stock) as total_stock,
                    SUM(available_stock) as available_stock
                FROM inventory
            `)
        ]);

        res.json({
            shipping: shippingStats.rows,
            inspection: inspectionStats.rows[0],
            inventory: inventoryStats.rows[0]
        });
    } catch (error) {
        logger.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 本日の検品実績統計
app.get('/reports/daily-inspection-stats', async (req, res) => {
    try {
        // 検品完了・失敗のカウントはqr_inspectionsから取得
        const inspectionResult = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'completed' AND DATE(completed_at) = CURRENT_DATE) as completed_today,
                COUNT(*) FILTER (WHERE status = 'failed' AND DATE(completed_at) = CURRENT_DATE) as failed_today
            FROM qr_inspections
        `);

        // 待機中のカウントはshipping_instructionsから取得（検品待ち出荷指示一覧と一致させる）
        const pendingResult = await pool.query(`
            SELECT COUNT(*) as in_progress
            FROM shipping_instructions
            WHERE status = 'pending'
        `);

        const inspectionStats = inspectionResult.rows[0];
        const pendingStats = pendingResult.rows[0];

        // 合格率の計算
        const completedToday = parseInt(inspectionStats.completed_today) || 0;
        const failedToday = parseInt(inspectionStats.failed_today) || 0;
        const totalInspections = completedToday + failedToday;
        const passRateToday = totalInspections > 0 ? (completedToday * 100.0 / totalInspections) : 0;

        const result = {
            rows: [{
                completed_today: completedToday,
                in_progress: parseInt(pendingStats.in_progress) || 0,
                failed_today: failedToday,
                pass_rate_today: passRateToday
            }]
        };

        const stats = result.rows[0];

        res.json({
            completed_today: parseInt(stats.completed_today) || 0,
            in_progress: parseInt(stats.in_progress) || 0,
            failed_today: parseInt(stats.failed_today) || 0,
            pass_rate_today: parseFloat(stats.pass_rate_today) || 0
        });
    } catch (error) {
        logger.error('Error fetching daily inspection stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 最近の検品履歴
app.get('/reports/recent-inspections', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;

        const result = await pool.query(`
            SELECT
                qi.id,
                qi.inspector_name,
                qi.status,
                qi.completed_at,
                qi.created_at,
                si.instruction_id,
                p.product_name
            FROM qr_inspections qi
            LEFT JOIN shipping_instructions si ON qi.shipping_instruction_id = si.id
            LEFT JOIN products p ON qi.product_id = p.id
            WHERE qi.status IN ('completed', 'failed')
            ORDER BY COALESCE(qi.completed_at, qi.created_at) DESC
            LIMIT $1
        `, [limit]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching recent inspections:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === QC七つ道具API ===

// パレート図データ
app.get('/qc-tools/pareto', async (req, res) => {
    try {
        const period = req.query.period || 'week';
        let dateFilter = "DATE(qi.completed_at) >= CURRENT_DATE - INTERVAL '7 days'";

        if (period === 'today') {
            dateFilter = "DATE(qi.completed_at) = CURRENT_DATE";
        } else if (period === 'month') {
            dateFilter = "DATE(qi.completed_at) >= CURRENT_DATE - INTERVAL '30 days'";
        } else if (period === 'quarter') {
            dateFilter = "DATE(qi.completed_at) >= CURRENT_DATE - INTERVAL '90 days'";
        }

        // 不良原因別の集計（qr_inspection_detailsのステータスがerrorのものを集計）
        const result = await pool.query(`
            SELECT
                COALESCE(qid.error_message, '未分類') as category,
                COUNT(*) as count
            FROM qr_inspection_details qid
            JOIN qr_inspections qi ON qid.qr_inspection_id = qi.id
            WHERE qid.status = 'error' AND ${dateFilter}
            GROUP BY COALESCE(qid.error_message, '未分類')
            ORDER BY count DESC
        `);

        const categories = result.rows.map(r => r.category);
        const counts = result.rows.map(r => parseInt(r.count));
        const total = counts.reduce((a, b) => a + b, 0);

        // 累積比率の計算
        let cumulative = [];
        let sum = 0;
        for (let count of counts) {
            sum += count;
            cumulative.push((sum / total * 100).toFixed(1));
        }

        // 統計情報
        const top3Sum = counts.slice(0, 3).reduce((a, b) => a + b, 0);
        const top3Percentage = total > 0 ? ((top3Sum / total) * 100).toFixed(1) : 0;

        // 80%ラインまでの項目数
        let items80 = 0;
        let running = 0;
        for (let count of counts) {
            running += count;
            items80++;
            if ((running / total) >= 0.8) break;
        }

        // 推奨アクション
        const recommendations = [];
        if (top3Percentage > 70) {
            recommendations.push(`上位3項目で${top3Percentage}%を占めています。重点的に対策してください。`);
        }
        if (items80 <= 3) {
            recommendations.push(`80%の不良が${items80}項目に集中しています。優先的に改善を実施してください。`);
        }

        res.json({
            categories,
            counts,
            cumulative: cumulative.map(parseFloat),
            total,
            top3_percentage: parseFloat(top3Percentage),
            items_to_80: items80,
            recommendations
        });
    } catch (error) {
        logger.error('Error fetching pareto data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 管理図データ
app.get('/qc-tools/control-chart', async (req, res) => {
    try {
        const metric = req.query.metric || 'defect_rate';

        // 過去30日のデータを取得
        const result = await pool.query(`
            SELECT
                DATE(qi.completed_at) as date,
                COUNT(*) as total_inspections,
                SUM(CASE WHEN qi.status = 'failed' THEN 1 ELSE 0 END) as failed_count
            FROM qr_inspections qi
            WHERE qi.completed_at >= CURRENT_DATE - INTERVAL '30 days'
                AND qi.status IN ('completed', 'failed')
            GROUP BY DATE(qi.completed_at)
            ORDER BY date
        `);

        const dates = result.rows.map(r => r.date);
        const values = result.rows.map(r => {
            const total = parseInt(r.total_inspections);
            const failed = parseInt(r.failed_count);
            return total > 0 ? ((failed / total) * 100).toFixed(2) : 0;
        }).map(parseFloat);

        // 管理限界の計算（平均 ± 3σ）
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        const std = Math.sqrt(variance);

        const ucl = mean + 3 * std; // 上方管理限界
        const cl = mean;             // 中心線
        const lcl = Math.max(0, mean - 3 * std); // 下方管理限界（0以下にならない）

        // 管理外点の検出
        const alerts = [];
        let inControl = true;
        values.forEach((val, idx) => {
            if (val > ucl || val < lcl) {
                alerts.push(`${dates[idx]}: 管理限界外 (${val.toFixed(2)}%)`);
                inControl = false;
            }
        });

        res.json({
            dates,
            values,
            ucl,
            cl,
            lcl,
            in_control: inControl,
            alerts
        });
    } catch (error) {
        logger.error('Error fetching control chart data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ヒストグラムデータ
app.get('/qc-tools/histogram', async (req, res) => {
    try {
        const metric = req.query.metric || 'inspection_time';

        // サンプルデータ生成（実際にはqr_inspectionsから取得）
        const result = await pool.query(`
            SELECT
                EXTRACT(EPOCH FROM (qi.completed_at - qi.created_at))/60 as inspection_time_minutes
            FROM qr_inspections qi
            WHERE qi.status = 'completed'
                AND qi.completed_at IS NOT NULL
                AND qi.created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);

        const data = result.rows.map(r => parseFloat(r.inspection_time_minutes));

        // ヒストグラムのビン（階級）を作成
        const min = Math.min(...data);
        const max = Math.max(...data);
        const binCount = 10;
        const binWidth = (max - min) / binCount;

        const bins = [];
        const frequencies = new Array(binCount).fill(0);

        for (let i = 0; i < binCount; i++) {
            const binStart = min + i * binWidth;
            const binEnd = min + (i + 1) * binWidth;
            bins.push(`${binStart.toFixed(1)}-${binEnd.toFixed(1)}`);

            // 度数をカウント
            frequencies[i] = data.filter(val => val >= binStart && val < binEnd).length;
        }

        // 統計量の計算
        const mean = data.reduce((a, b) => a + b, 0) / data.length;
        const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
        const std = Math.sqrt(variance);
        const range = max - min;

        res.json({
            bins,
            frequencies,
            mean,
            std,
            range
        });
    } catch (error) {
        logger.error('Error fetching histogram data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 散布図データ
app.get('/qc-tools/scatter', async (req, res) => {
    try {
        const xMetric = req.query.x || 'inspection_time';
        const yMetric = req.query.y || 'defect_rate';

        const result = await pool.query(`
            SELECT
                EXTRACT(EPOCH FROM (qi.completed_at - qi.created_at))/60 as inspection_time,
                qi.total_components as total_components,
                qi.scanned_components as scanned_components,
                CASE
                    WHEN qi.total_components > 0
                    THEN ((qi.total_components - qi.scanned_components)::float / qi.total_components * 100)
                    ELSE 0
                END as defect_rate
            FROM qr_inspections qi
            WHERE qi.status = 'completed'
                AND qi.completed_at IS NOT NULL
                AND qi.created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);

        const points = result.rows.map(r => ({
            x: parseFloat(r.inspection_time) || 0,
            y: parseFloat(r.defect_rate) || 0
        }));

        // 相関係数の計算
        const xValues = points.map(p => p.x);
        const yValues = points.map(p => p.y);
        const correlation = calculateCorrelation(xValues, yValues);

        res.json({
            points,
            correlation
        });
    } catch (error) {
        logger.error('Error fetching scatter data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// チェックシートデータ
app.get('/qc-tools/checksheet', async (req, res) => {
    try {
        // 週次の検査項目別チェック数
        const result = await pool.query(`
            SELECT
                pc.component_type,
                EXTRACT(DOW FROM qid.scanned_at) as day_of_week,
                COUNT(*) as check_count
            FROM qr_inspection_details qid
            JOIN product_components pc ON qid.product_component_id = pc.id
            WHERE qid.scanned_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY pc.component_type, EXTRACT(DOW FROM qid.scanned_at)
            ORDER BY pc.component_type, day_of_week
        `);

        // 検査項目ごとに曜日別集計を作成
        const itemsMap = new Map();

        result.rows.forEach(row => {
            const type = row.component_type;
            if (!itemsMap.has(type)) {
                itemsMap.set(type, {
                    name: type,
                    daily_counts: new Array(7).fill(0),
                    total: 0
                });
            }

            const dayIndex = parseInt(row.day_of_week); // 0=日, 1=月, ..., 6=土
            const count = parseInt(row.check_count);
            itemsMap.get(type).daily_counts[dayIndex] = count;
            itemsMap.get(type).total += count;
        });

        const items = Array.from(itemsMap.values());
        const totalChecks = items.reduce((sum, item) => sum + item.total, 0);

        res.json({
            items,
            total_items: items.length,
            total_checks: totalChecks
        });
    } catch (error) {
        logger.error('Error fetching checksheet data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 相関係数計算ヘルパー関数
function calculateCorrelation(x, y) {
    const n = x.length;
    if (n === 0) return 0;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
}

// QCツール用サンプルデータ生成
app.post('/qc-tools/generate-sample-data', async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 既存のサンプルデータを削除
        await client.query(`
            DELETE FROM qr_inspection_details WHERE qr_inspection_id IN (
                SELECT id FROM qr_inspections WHERE inspector_name LIKE 'サンプル%'
            )
        `);
        await client.query(`DELETE FROM qr_inspections WHERE inspector_name LIKE 'サンプル%'`);

        const errorMessages = [
            '部品欠品',
            '外観不良',
            '数量不一致',
            'QRコード読み取り不可',
            '梱包不良',
            '製品破損',
            'ラベル貼付不良',
            '仕様違い'
        ];

        let totalInspections = 0;
        let totalDetails = 0;

        // 過去30日分のデータを生成
        for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
            const inspectionsPerDay = 3 + Math.floor(Math.random() * 7); // 3〜10件/日

            for (let i = 0; i < inspectionsPerDay; i++) {
                // ランダムに製品と出荷指示を選択
                const productResult = await client.query('SELECT id FROM products ORDER BY RANDOM() LIMIT 1');
                const shippingResult = await client.query('SELECT id FROM shipping_instructions ORDER BY RANDOM() LIMIT 1');

                if (productResult.rows.length === 0 || shippingResult.rows.length === 0) {
                    continue;
                }

                const productId = productResult.rows[0].id;
                const shippingInstructionId = shippingResult.rows[0].id;

                // 検品時間をランダムに生成（5〜30分）
                const inspectionMinutes = 5 + Math.floor(Math.random() * 25);

                // 失敗か成功かをランダムに決定（10%の確率で失敗）
                const isFailed = Math.random() < 0.1;

                // 製品の総部品数を取得
                const componentsResult = await client.query(
                    'SELECT COUNT(*) as count FROM product_components WHERE product_id = $1',
                    [productId]
                );

                let totalComponents = parseInt(componentsResult.rows[0].count) || 3;
                if (totalComponents === 0) totalComponents = 3;

                // スキャンした部品数（失敗の場合は少なめ）
                const scannedComponents = isFailed
                    ? totalComponents - (1 + Math.floor(Math.random() * 2))
                    : totalComponents;

                // 基準日時を計算
                const baseDate = new Date();
                baseDate.setDate(baseDate.getDate() - dayOffset);
                baseDate.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);

                const completedDate = new Date(baseDate.getTime() + inspectionMinutes * 60000);

                // QR検品レコードを挿入
                const inspectionResult = await client.query(`
                    INSERT INTO qr_inspections (
                        shipping_instruction_id,
                        inspector_name,
                        product_id,
                        total_components,
                        scanned_components,
                        passed_quantity,
                        status,
                        created_at,
                        completed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    RETURNING id
                `, [
                    shippingInstructionId,
                    'サンプル検品員' + (1 + Math.floor(Math.random() * 5)),
                    productId,
                    totalComponents,
                    scannedComponents,
                    isFailed ? 0 : 1,
                    isFailed ? 'failed' : 'completed',
                    baseDate,
                    completedDate
                ]);

                const inspectionId = inspectionResult.rows[0].id;
                totalInspections++;

                // 部品を取得
                const componentsListResult = await client.query(
                    'SELECT id FROM product_components WHERE product_id = $1 LIMIT $2',
                    [productId, totalComponents]
                );

                // 検品詳細データを挿入
                for (let j = 0; j < totalComponents; j++) {
                    const componentId = componentsListResult.rows[j]?.id || componentsListResult.rows[0]?.id;

                    if (!componentId) continue;

                    const scanDate = new Date(baseDate.getTime() + j * 30000); // 30秒間隔

                    // 失敗検品の場合、一部をエラーとして記録
                    if (isFailed && j >= scannedComponents) {
                        const errorMsg = errorMessages[Math.floor(Math.random() * errorMessages.length)];

                        await client.query(`
                            INSERT INTO qr_inspection_details (
                                qr_inspection_id,
                                product_component_id,
                                qr_code,
                                status,
                                error_message,
                                scanned_at
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `, [
                            inspectionId,
                            componentId,
                            'QR-ERROR-' + j,
                            'error',
                            errorMsg,
                            scanDate
                        ]);
                    } else {
                        // 正常スキャン
                        await client.query(`
                            INSERT INTO qr_inspection_details (
                                qr_inspection_id,
                                product_component_id,
                                qr_code,
                                status,
                                scanned_at
                            ) VALUES ($1, $2, $3, $4, $5)
                        `, [
                            inspectionId,
                            componentId,
                            'QR-OK-' + j,
                            'scanned',
                            scanDate
                        ]);
                    }

                    totalDetails++;
                }
            }
        }

        await client.query('COMMIT');

        logger.info(`Sample data generated: ${totalInspections} inspections, ${totalDetails} details`);

        res.json({
            success: true,
            message: 'サンプルデータの生成が完了しました',
            total_inspections: totalInspections,
            total_details: totalDetails
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error generating sample data:', error);
        res.status(500).json({ error: 'サンプルデータの生成に失敗しました: ' + error.message });
    } finally {
        client.release();
    }
});

// === 在庫管理API ===

// 在庫一覧取得
app.get('/inventory', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, p.product_code, p.product_name, p.category
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            ORDER BY p.product_code
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 在庫詳細取得
app.get('/inventory/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT i.*, p.product_code, p.product_name, p.category
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE i.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inventory record not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 在庫調整（現在庫・引当在庫の更新）
app.patch('/inventory/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { current_stock, reserved_stock, location } = req.body;

        // 少なくとも1つのフィールドが必要
        if (current_stock === undefined && reserved_stock === undefined && location === undefined) {
            return res.status(400).json({
                error: 'At least one field (current_stock, reserved_stock, or location) must be provided'
            });
        }

        // 負の値チェック
        if ((current_stock !== undefined && current_stock < 0) ||
            (reserved_stock !== undefined && reserved_stock < 0)) {
            return res.status(400).json({
                error: 'Stock values cannot be negative'
            });
        }

        // 動的にUPDATE文を構築
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (current_stock !== undefined) {
            updates.push(`current_stock = $${paramIndex++}`);
            values.push(current_stock);
        }
        if (reserved_stock !== undefined) {
            updates.push(`reserved_stock = $${paramIndex++}`);
            values.push(reserved_stock);
        }
        if (location !== undefined) {
            updates.push(`location = $${paramIndex++}`);
            values.push(location);
        }
        updates.push(`last_updated = CURRENT_TIMESTAMP`);
        values.push(id);

        const query = `
            UPDATE inventory
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inventory record not found' });
        }

        logger.info('Inventory updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品IDで在庫取得
app.get('/inventory/by-product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await pool.query(`
            SELECT i.*, p.product_code, p.product_name, p.category
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE i.product_id = $1
        `, [productId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inventory record not found for this product' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching inventory by product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === データベース管理API ===

// データベース統計情報取得
app.get('/database/stats', async (req, res) => {
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
app.post('/database/backup', async (req, res) => {
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
app.get('/database/backups', async (req, res) => {
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
app.get('/logs/files', async (req, res) => {
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
app.get('/logs/content/:filename', async (req, res) => {
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
app.get('/new-qc/projects', async (req, res) => {
    try {
        const { tool_type } = req.query;

        let query = 'SELECT * FROM qc_analysis_projects';
        const params = [];

        if (tool_type) {
            query += ' WHERE tool_type = $1';
            params.push(tool_type);
        }

        query += ' ORDER BY updated_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching QC projects:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// プロジェクト詳細取得
app.get('/new-qc/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'SELECT * FROM qc_analysis_projects WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching QC project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// プロジェクト作成
app.post('/new-qc/projects', async (req, res) => {
    try {
        const schema = Joi.object({
            project_name: Joi.string().required().max(200),
            tool_type: Joi.string().required().valid(
                'affinity', 'relation', 'tree', 'matrix',
                'matrix_data', 'arrow', 'pdpc'
            ),
            description: Joi.string().allow('', null),
            created_by: Joi.string().max(100),
            is_template: Joi.boolean(),
            project_data: Joi.object()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const result = await pool.query(
            `INSERT INTO qc_analysis_projects
            (project_name, tool_type, description, created_by, is_template, project_data)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                value.project_name,
                value.tool_type,
                value.description || null,
                value.created_by || null,
                value.is_template || false,
                JSON.stringify(value.project_data || {})
            ]
        );

        logger.info(`New QC project created: ${result.rows[0].id}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating QC project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// プロジェクト更新
app.put('/new-qc/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { project_name, description, project_data } = req.body;

        const result = await pool.query(
            `UPDATE qc_analysis_projects
            SET project_name = COALESCE($1, project_name),
                description = COALESCE($2, description),
                project_data = COALESCE($3, project_data),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *`,
            [project_name, description, project_data ? JSON.stringify(project_data) : null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating QC project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// プロジェクト削除
app.delete('/new-qc/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_analysis_projects WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        logger.info(`QC project deleted: ${id}`);
        res.json({ message: 'Project deleted successfully', id: result.rows[0].id });
    } catch (error) {
        logger.error('Error deleting QC project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 親和図法（KJ法）---

// カード一覧取得
app.get('/new-qc/affinity/:projectId/cards', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            `SELECT * FROM qc_affinity_cards
            WHERE project_id = $1
            ORDER BY group_name, position_y, position_x`,
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching affinity cards:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// カード追加
app.post('/new-qc/affinity/:projectId/cards', async (req, res) => {
    try {
        const { projectId } = req.params;
        const schema = Joi.object({
            card_text: Joi.string().required(),
            group_name: Joi.string().allow('', null).max(200),
            position_x: Joi.number().integer().default(0),
            position_y: Joi.number().integer().default(0),
            color: Joi.string().max(20).default('#fff3cd')
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const result = await pool.query(
            `INSERT INTO qc_affinity_cards
            (project_id, card_text, group_name, position_x, position_y, color)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                projectId,
                value.card_text,
                value.group_name || null,
                value.position_x,
                value.position_y,
                value.color
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating affinity card:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// カード更新
app.put('/new-qc/affinity/cards/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { card_text, group_name, position_x, position_y, color } = req.body;

        const result = await pool.query(
            `UPDATE qc_affinity_cards
            SET card_text = COALESCE($1, card_text),
                group_name = COALESCE($2, group_name),
                position_x = COALESCE($3, position_x),
                position_y = COALESCE($4, position_y),
                color = COALESCE($5, color),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *`,
            [card_text, group_name, position_x, position_y, color, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Card not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating affinity card:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// カード削除
app.delete('/new-qc/affinity/cards/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_affinity_cards WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Card not found' });
        }

        res.json({ message: 'Card deleted successfully' });
    } catch (error) {
        logger.error('Error deleting affinity card:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 連関図法 ---

// ノード一覧取得
app.get('/new-qc/relation/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            'SELECT * FROM qc_relation_nodes WHERE project_id = $1 ORDER BY created_at',
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching relation nodes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ノード追加
app.post('/new-qc/relation/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { node_text, node_type, position_x, position_y, color } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_relation_nodes
            (project_id, node_text, node_type, position_x, position_y, color)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                projectId,
                node_text,
                node_type || 'factor',
                position_x || 0,
                position_y || 0,
                color || '#d1ecf1'
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating relation node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// エッジ一覧取得
app.get('/new-qc/relation/:projectId/edges', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            'SELECT * FROM qc_relation_edges WHERE project_id = $1 ORDER BY created_at',
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching relation edges:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// エッジ追加
app.post('/new-qc/relation/:projectId/edges', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { from_node_id, to_node_id, edge_label, strength } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_relation_edges
            (project_id, from_node_id, to_node_id, edge_label, strength)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [
                projectId,
                from_node_id,
                to_node_id,
                edge_label || null,
                strength || 'medium'
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating relation edge:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ノード削除
app.delete('/new-qc/relation/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_relation_nodes WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json({ message: 'Node deleted successfully' });
    } catch (error) {
        logger.error('Error deleting relation node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// エッジ削除
app.delete('/new-qc/relation/edges/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_relation_edges WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Edge not found' });
        }

        res.json({ message: 'Edge deleted successfully' });
    } catch (error) {
        logger.error('Error deleting relation edge:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 系統図法（ツリー図）---

// ツリーノード一覧取得
app.get('/new-qc/tree/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            `SELECT * FROM qc_tree_nodes
            WHERE project_id = $1
            ORDER BY node_level, node_order`,
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching tree nodes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ツリーノード追加
app.post('/new-qc/tree/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { parent_node_id, node_text, node_level, node_order, node_type } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_tree_nodes
            (project_id, parent_node_id, node_text, node_level, node_order, node_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                projectId,
                parent_node_id || null,
                node_text,
                node_level || 0,
                node_order || 0,
                node_type || 'objective'
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating tree node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ツリーノード更新
app.put('/new-qc/tree/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { node_text, node_order } = req.body;

        const result = await pool.query(
            `UPDATE qc_tree_nodes
            SET node_text = COALESCE($1, node_text),
                node_order = COALESCE($2, node_order),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *`,
            [node_text, node_order, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating tree node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ツリーノード削除
app.delete('/new-qc/tree/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_tree_nodes WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json({ message: 'Node deleted successfully' });
    } catch (error) {
        logger.error('Error deleting tree node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- マトリックス図法 ---

// マトリックスデータ取得（項目とセル）
app.get('/new-qc/matrix/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        const itemsResult = await pool.query(
            `SELECT * FROM qc_matrix_items
            WHERE project_id = $1
            ORDER BY item_type, item_order`,
            [projectId]
        );

        const cellsResult = await pool.query(
            `SELECT * FROM qc_matrix_cells WHERE project_id = $1`,
            [projectId]
        );

        res.json({
            items: itemsResult.rows,
            cells: cellsResult.rows
        });
    } catch (error) {
        logger.error('Error fetching matrix data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// マトリックス項目追加
app.post('/new-qc/matrix/:projectId/items', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { item_text, item_type, item_order } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_matrix_items
            (project_id, item_text, item_type, item_order)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [projectId, item_text, item_type, item_order || 0]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating matrix item:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// マトリックスセル更新
app.put('/new-qc/matrix/cells', async (req, res) => {
    try {
        const { project_id, row_item_id, column_item_id, relationship_strength, relationship_value, note } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_matrix_cells
            (project_id, row_item_id, column_item_id, relationship_strength, relationship_value, note)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (row_item_id, column_item_id)
            DO UPDATE SET
                relationship_strength = EXCLUDED.relationship_strength,
                relationship_value = EXCLUDED.relationship_value,
                note = EXCLUDED.note,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *`,
            [project_id, row_item_id, column_item_id, relationship_strength, relationship_value, note]
        );

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating matrix cell:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// マトリックス項目削除
app.delete('/new-qc/matrix/items/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_matrix_items WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }

        res.json({ message: 'Item deleted successfully' });
    } catch (error) {
        logger.error('Error deleting matrix item:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- アローダイアグラム（PERT図）---

// PERT図データ取得
app.get('/new-qc/arrow/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        const tasksResult = await pool.query(
            'SELECT * FROM qc_arrow_tasks WHERE project_id = $1 ORDER BY id',
            [projectId]
        );

        const depsResult = await pool.query(
            'SELECT * FROM qc_arrow_dependencies WHERE project_id = $1',
            [projectId]
        );

        res.json({
            tasks: tasksResult.rows,
            dependencies: depsResult.rows
        });
    } catch (error) {
        logger.error('Error fetching arrow diagram:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// タスク追加
app.post('/new-qc/arrow/:projectId/tasks', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { task_name, task_duration, position_x, position_y } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_arrow_tasks
            (project_id, task_name, task_duration, position_x, position_y)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [projectId, task_name, task_duration || 0, position_x || 0, position_y || 0]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating arrow task:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 依存関係追加
app.post('/new-qc/arrow/:projectId/dependencies', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { predecessor_task_id, successor_task_id, dependency_type } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_arrow_dependencies
            (project_id, predecessor_task_id, successor_task_id, dependency_type)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [projectId, predecessor_task_id, successor_task_id, dependency_type || 'FS']
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating arrow dependency:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// クリティカルパス計算
app.post('/new-qc/arrow/:projectId/calculate', async (req, res) => {
    try {
        const { projectId } = req.params;

        // タスクと依存関係を取得
        const tasksResult = await pool.query(
            'SELECT * FROM qc_arrow_tasks WHERE project_id = $1',
            [projectId]
        );

        const depsResult = await pool.query(
            'SELECT * FROM qc_arrow_dependencies WHERE project_id = $1',
            [projectId]
        );

        const tasks = tasksResult.rows;
        const dependencies = depsResult.rows;

        // クリティカルパス計算ロジック（簡易版）
        const taskMap = new Map(tasks.map(t => [t.id, {
            ...t,
            earliest_start: 0,
            latest_start: 0,
            slack_time: 0,
            is_critical: false
        }]));

        // 前向き計算（最早開始時刻）
        tasks.forEach(task => {
            const predecessors = dependencies.filter(d => d.successor_task_id === task.id);
            let maxFinish = 0;

            predecessors.forEach(dep => {
                const pred = taskMap.get(dep.predecessor_task_id);
                const finish = pred.earliest_start + parseFloat(pred.task_duration);
                maxFinish = Math.max(maxFinish, finish);
            });

            taskMap.get(task.id).earliest_start = maxFinish;
        });

        // プロジェクト完了時刻
        const projectFinish = Math.max(...Array.from(taskMap.values()).map(
            t => t.earliest_start + parseFloat(t.task_duration)
        ));

        // 後ろ向き計算（最遅開始時刻）
        taskMap.forEach(task => {
            const successors = dependencies.filter(d => d.predecessor_task_id === task.id);

            if (successors.length === 0) {
                task.latest_start = projectFinish - parseFloat(task.task_duration);
            } else {
                let minSuccessorStart = Infinity;
                successors.forEach(dep => {
                    const succ = taskMap.get(dep.successor_task_id);
                    minSuccessorStart = Math.min(minSuccessorStart, succ.latest_start);
                });
                task.latest_start = minSuccessorStart - parseFloat(task.task_duration);
            }

            task.slack_time = task.latest_start - task.earliest_start;
            task.is_critical = task.slack_time === 0;
        });

        // データベース更新
        for (const task of taskMap.values()) {
            await pool.query(
                `UPDATE qc_arrow_tasks
                SET earliest_start = $1, latest_start = $2, slack_time = $3, is_critical = $4
                WHERE id = $5`,
                [task.earliest_start, task.latest_start, task.slack_time, task.is_critical, task.id]
            );
        }

        res.json({
            project_duration: projectFinish,
            critical_path: Array.from(taskMap.values()).filter(t => t.is_critical),
            tasks: Array.from(taskMap.values())
        });
    } catch (error) {
        logger.error('Error calculating critical path:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- PDPC法 ---

// PDPCノード一覧取得
app.get('/new-qc/pdpc/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;

        const result = await pool.query(
            `SELECT * FROM qc_pdpc_nodes
            WHERE project_id = $1
            ORDER BY node_level, id`,
            [projectId]
        );

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching PDPC nodes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PDPCノード追加
app.post('/new-qc/pdpc/:projectId/nodes', async (req, res) => {
    try {
        const { projectId } = req.params;
        const {
            parent_node_id, node_text, node_type, node_level,
            probability, impact_level, position_x, position_y
        } = req.body;

        const result = await pool.query(
            `INSERT INTO qc_pdpc_nodes
            (project_id, parent_node_id, node_text, node_type, node_level,
             probability, impact_level, position_x, position_y)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                projectId,
                parent_node_id || null,
                node_text,
                node_type || 'process',
                node_level || 0,
                probability || null,
                impact_level || null,
                position_x || 0,
                position_y || 0
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating PDPC node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PDPCノード更新
app.put('/new-qc/pdpc/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { node_text, probability, impact_level, position_x, position_y } = req.body;

        const result = await pool.query(
            `UPDATE qc_pdpc_nodes
            SET node_text = COALESCE($1, node_text),
                probability = COALESCE($2, probability),
                impact_level = COALESCE($3, impact_level),
                position_x = COALESCE($4, position_x),
                position_y = COALESCE($5, position_y),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *`,
            [node_text, probability, impact_level, position_x, position_y, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating PDPC node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PDPCノード削除
app.delete('/new-qc/pdpc/nodes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM qc_pdpc_nodes WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Node not found' });
        }

        res.json({ message: 'Node deleted successfully' });
    } catch (error) {
        logger.error('Error deleting PDPC node:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==============================================
// モニタリング・分析 API
// ==============================================

// --- リアルタイム出荷モニタリング ---

// 本日の出荷状況サマリー
app.get('/monitoring/shipment-realtime', async (req, res) => {
    try {
        const result = await pool.query(`
            WITH today_inspections AS (
                SELECT
                    COUNT(*) as total_today,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_today,
                    SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_today,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_today,
                    AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60) FILTER (WHERE completed_at IS NOT NULL) as avg_time
                FROM qr_inspections
                WHERE DATE(created_at) = CURRENT_DATE
            ),
            hourly_trend AS (
                SELECT
                    EXTRACT(HOUR FROM created_at) as hour,
                    COUNT(*) as count
                FROM qr_inspections
                WHERE DATE(created_at) = CURRENT_DATE
                GROUP BY EXTRACT(HOUR FROM created_at)
                ORDER BY hour
            ),
            queue_status AS (
                SELECT COUNT(*) as waiting_count
                FROM shipping_instructions
                WHERE shipment_status = 'pending'
            )
            SELECT
                ti.*,
                qs.waiting_count,
                COALESCE(
                    (SELECT JSON_AGG(JSON_BUILD_OBJECT('hour', hour, 'count', count) ORDER BY hour)
                     FROM hourly_trend),
                    '[]'::json
                ) as hourly_data
            FROM today_inspections ti, queue_status qs
        `);

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching shipment realtime data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 時間帯別出荷推移（過去7日間）
app.get('/monitoring/shipment-trend', async (req, res) => {
    try {
        const { days = 7 } = req.query;

        const result = await pool.query(`
            SELECT
                DATE(created_at) as date,
                EXTRACT(HOUR FROM created_at) as hour,
                COUNT(*) as inspection_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
            FROM qr_inspections
            WHERE created_at > CURRENT_DATE - INTERVAL '${parseInt(days)} days'
            GROUP BY DATE(created_at), EXTRACT(HOUR FROM created_at)
            ORDER BY date DESC, hour
        `);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipment trend:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品別出荷実績（トップN）
app.get('/monitoring/product-shipment-ranking', async (req, res) => {
    try {
        const { period = 30, limit = 10 } = req.query;

        const result = await pool.query(`
            SELECT
                p.id,
                p.product_name,
                p.product_code,
                COUNT(qi.id) as shipment_count,
                SUM(qi.passed_quantity) as total_quantity,
                ROUND(AVG(EXTRACT(EPOCH FROM (qi.completed_at - qi.created_at)) / 60)::NUMERIC, 2) as avg_inspection_time,
                SUM(CASE WHEN qi.status = 'failed' THEN 1 ELSE 0 END) as failed_count
            FROM products p
            LEFT JOIN qr_inspections qi ON p.id = qi.product_id
            WHERE qi.created_at > CURRENT_DATE - INTERVAL '${parseInt(period)} days'
            GROUP BY p.id, p.product_name, p.product_code
            ORDER BY shipment_count DESC
            LIMIT $1
        `, [parseInt(limit)]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching product shipment ranking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 検品員別パフォーマンス分析 ---

// 検品員パフォーマンスサマリー
app.get('/monitoring/inspector-performance', async (req, res) => {
    try {
        const { period = 7 } = req.query;

        const result = await pool.query(`
            SELECT
                inspector_name,
                COUNT(*) as total_inspections,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
                ROUND((SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::NUMERIC /
                       NULLIF(COUNT(*), 0) * 100), 2) as success_rate,
                ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)::NUMERIC, 2) as avg_inspection_time,
                SUM(scanned_components) as total_components,
                ROUND((SUM(scanned_components)::NUMERIC / NULLIF(COUNT(*), 0)), 1) as avg_components_per_inspection,
                MIN(created_at) as first_inspection,
                MAX(completed_at) as last_inspection
            FROM qr_inspections
            WHERE created_at > CURRENT_DATE - INTERVAL '${parseInt(period)} days'
              AND inspector_name IS NOT NULL
            GROUP BY inspector_name
            ORDER BY total_inspections DESC
        `);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inspector performance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品員別時間帯パフォーマンス
app.get('/monitoring/inspector-hourly-performance', async (req, res) => {
    try {
        const { inspector_name } = req.query;

        let query = `
            SELECT
                inspector_name,
                EXTRACT(HOUR FROM created_at) as hour,
                COUNT(*) as inspection_count,
                ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)::NUMERIC, 2) as avg_time
            FROM qr_inspections
            WHERE created_at > CURRENT_DATE - INTERVAL '7 days'
              AND inspector_name IS NOT NULL
        `;

        const params = [];
        if (inspector_name) {
            params.push(inspector_name);
            query += ` AND inspector_name = $1`;
        }

        query += ` GROUP BY inspector_name, EXTRACT(HOUR FROM created_at) ORDER BY inspector_name, hour`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inspector hourly performance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 在庫健全性KPI ---

// 在庫健全性ダッシュボード
app.get('/monitoring/inventory-health', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                product_id,
                product_name,
                product_code,
                current_stock,
                reserved_stock,
                available_stock,
                avg_daily_demand,
                demand_volatility,
                days_of_stock,
                turnover_rate,
                health_status
            FROM v_inventory_health
            ORDER BY
                CASE health_status
                    WHEN 'critical' THEN 1
                    WHEN 'warning' THEN 2
                    WHEN 'overstocked' THEN 3
                    ELSE 4
                END,
                days_of_stock NULLS LAST
        `);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory health:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 在庫回転率ランキング
app.get('/monitoring/inventory-turnover', async (req, res) => {
    try {
        const { limit = 20, order = 'desc' } = req.query;

        const result = await pool.query(`
            SELECT
                product_id,
                product_name,
                product_code,
                current_stock,
                available_stock,
                turnover_rate,
                health_status
            FROM v_inventory_health
            WHERE turnover_rate IS NOT NULL
            ORDER BY turnover_rate ${order === 'asc' ? 'ASC' : 'DESC'}
            LIMIT $1
        `, [parseInt(limit)]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory turnover:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// デッドストック検出（90日以上未出荷）
app.get('/monitoring/dead-stock', async (req, res) => {
    try {
        const { days = 90 } = req.query;

        const result = await pool.query(`
            WITH last_shipment AS (
                SELECT
                    product_id,
                    MAX(completed_at) as last_shipment_date,
                    COUNT(*) as total_shipments
                FROM qr_inspections
                WHERE status = 'completed'
                GROUP BY product_id
            )
            SELECT
                p.id as product_id,
                p.product_name,
                p.product_code,
                i.current_stock,
                i.available_stock,
                ls.last_shipment_date,
                CURRENT_DATE - DATE(ls.last_shipment_date) as days_since_shipment,
                ls.total_shipments
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            LEFT JOIN last_shipment ls ON p.id = ls.product_id
            WHERE (ls.last_shipment_date IS NULL OR
                   CURRENT_DATE - DATE(ls.last_shipment_date) > $1)
              AND i.available_stock > 0
            ORDER BY days_since_shipment DESC NULLS FIRST
        `, [parseInt(days)]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching dead stock:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 欠品リスクアラート ---

// 欠品リスク製品リスト
app.get('/monitoring/stockout-risk', async (req, res) => {
    try {
        const { threshold = 7 } = req.query;  // デフォルト7日分以下

        const result = await pool.query(`
            SELECT
                product_id,
                product_name,
                product_code,
                current_stock,
                reserved_stock,
                available_stock,
                avg_daily_demand,
                days_of_stock,
                health_status,
                CASE
                    WHEN days_of_stock < 3 THEN 'critical'
                    WHEN days_of_stock < 7 THEN 'high'
                    WHEN days_of_stock < 14 THEN 'medium'
                    ELSE 'low'
                END as risk_level
            FROM v_inventory_health
            WHERE days_of_stock IS NOT NULL
              AND days_of_stock < $1
            ORDER BY days_of_stock ASC
        `, [parseInt(threshold)]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching stockout risk:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// アラート作成
app.post('/monitoring/alerts', async (req, res) => {
    try {
        const schema = Joi.object({
            alert_type: Joi.string().required(),
            severity: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
            product_id: Joi.number().integer(),
            alert_message: Joi.string().required(),
            alert_data: Joi.object(),
            expires_at: Joi.date()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const result = await pool.query(`
            INSERT INTO monitoring_alerts
            (alert_type, severity, product_id, alert_message, alert_data, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            value.alert_type,
            value.severity,
            value.product_id || null,
            value.alert_message,
            JSON.stringify(value.alert_data || {}),
            value.expires_at || null
        ]);

        logger.info(`Alert created: ${value.alert_type} - ${value.severity}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating alert:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// アクティブアラート一覧
app.get('/monitoring/alerts', async (req, res) => {
    try {
        const { severity, alert_type, acknowledged } = req.query;

        let query = `
            SELECT *
            FROM monitoring_alerts
            WHERE (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        `;

        const params = [];
        let paramIndex = 1;

        if (severity) {
            params.push(severity);
            query += ` AND severity = $${paramIndex++}`;
        }

        if (alert_type) {
            params.push(alert_type);
            query += ` AND alert_type = $${paramIndex++}`;
        }

        if (acknowledged !== undefined) {
            params.push(acknowledged === 'true');
            query += ` AND is_acknowledged = $${paramIndex++}`;
        }

        query += ` ORDER BY severity DESC, created_at DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching alerts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// アラート確認
app.patch('/monitoring/alerts/:id/acknowledge', async (req, res) => {
    try {
        const { id } = req.params;
        const { acknowledged_by } = req.body;

        const result = await pool.query(`
            UPDATE monitoring_alerts
            SET is_acknowledged = TRUE,
                acknowledged_by = $1,
                acknowledged_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [acknowledged_by || 'system', id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Alert not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error acknowledging alert:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 統合ダッシュボードサマリー ---

// モニタリングダッシュボード総合サマリー
app.get('/monitoring/dashboard-summary', async (req, res) => {
    try {
        const [shipmentData, inventoryData, alertData, performanceData] = await Promise.all([
            // 出荷状況
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as today_total,
                    COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE AND status = 'completed') as today_completed,
                    COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress
                FROM qr_inspections
            `),
            // 在庫状況
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE health_status = 'critical') as critical_count,
                    COUNT(*) FILTER (WHERE health_status = 'warning') as warning_count,
                    COUNT(*) FILTER (WHERE health_status = 'overstocked') as overstocked_count,
                    ROUND(AVG(turnover_rate)::NUMERIC, 2) as avg_turnover_rate
                FROM v_inventory_health
            `),
            // アラート状況
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE NOT is_acknowledged AND severity = 'critical') as critical_alerts,
                    COUNT(*) FILTER (WHERE NOT is_acknowledged AND severity = 'high') as high_alerts,
                    COUNT(*) FILTER (WHERE NOT is_acknowledged) as total_unacknowledged
                FROM monitoring_alerts
                WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
            `),
            // 検品員パフォーマンス
            pool.query(`
                SELECT
                    COUNT(DISTINCT inspector_name) as active_inspectors,
                    ROUND(AVG(success_rate)::NUMERIC, 2) as avg_success_rate
                FROM v_inspector_performance
            `)
        ]);

        res.json({
            shipment: shipmentData.rows[0],
            inventory: inventoryData.rows[0],
            alerts: alertData.rows[0],
            performance: performanceData.rows[0],
            generated_at: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Error fetching dashboard summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// サンプルデータ生成エンドポイント
app.post('/monitoring/generate-sample-data', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. 既存のモニタリングデータをクリア
        await client.query('DELETE FROM inventory_snapshots');
        await client.query('DELETE FROM inspection_performance_hourly');
        await client.query('DELETE FROM monitoring_alerts WHERE is_acknowledged = FALSE');

        // 2. 製品データを取得
        const productsResult = await client.query('SELECT id, product_name FROM products LIMIT 10');
        const products = productsResult.rows;

        if (products.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No products found. Please add products first.' });
        }

        // 3. 在庫スナップショットデータ生成（過去30日分）
        const inventorySnapshots = [];
        for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
            const snapshotDate = new Date();
            snapshotDate.setDate(snapshotDate.getDate() - dayOffset);
            const dateStr = snapshotDate.toISOString().split('T')[0];

            for (const product of products) {
                const baseStock = 100 + Math.floor(Math.random() * 500);
                const dailyShipments = 5 + Math.floor(Math.random() * 30);
                const dailyReceipts = dayOffset % 7 === 0 ? 50 + Math.floor(Math.random() * 100) : 0;
                const quantityOnHand = baseStock + (30 - dayOffset) * 5;
                const quantityReserved = Math.floor(Math.random() * 50);
                const quantityAvailable = quantityOnHand - quantityReserved;
                const turnoverRate = (dailyShipments / Math.max(quantityAvailable, 1) * 30).toFixed(4);
                const daysOfStock = (quantityAvailable / Math.max(dailyShipments, 1)).toFixed(2);

                inventorySnapshots.push({
                    date: dateStr,
                    product_id: product.id,
                    quantity_on_hand: quantityOnHand,
                    quantity_reserved: quantityReserved,
                    quantity_available: quantityAvailable,
                    daily_shipments: dailyShipments,
                    daily_receipts: dailyReceipts,
                    turnover_rate: turnoverRate,
                    days_of_stock: daysOfStock
                });
            }
        }

        // 在庫スナップショット一括挿入
        for (const snapshot of inventorySnapshots) {
            await client.query(`
                INSERT INTO inventory_snapshots
                (snapshot_date, product_id, quantity_on_hand, quantity_reserved,
                 quantity_available, daily_shipments, daily_receipts, turnover_rate, days_of_stock)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                snapshot.date, snapshot.product_id, snapshot.quantity_on_hand,
                snapshot.quantity_reserved, snapshot.quantity_available,
                snapshot.daily_shipments, snapshot.daily_receipts,
                snapshot.turnover_rate, snapshot.days_of_stock
            ]);
        }

        // 4. 検品パフォーマンスデータ生成（過去7日分、8時間/日）
        const inspectors = ['田中太郎', '佐藤花子', '鈴木一郎', '高橋美咲'];
        const performanceData = [];

        for (let dayOffset = 7; dayOffset >= 0; dayOffset--) {
            for (let hour = 9; hour <= 16; hour++) {
                const timestamp = new Date();
                timestamp.setDate(timestamp.getDate() - dayOffset);
                timestamp.setHours(hour, 0, 0, 0);

                for (const inspector of inspectors) {
                    const totalInspections = 2 + Math.floor(Math.random() * 8);
                    const completedInspections = totalInspections - Math.floor(Math.random() * 2);
                    const failedInspections = totalInspections - completedInspections;
                    const avgInspectionTime = (5 + Math.random() * 15).toFixed(2);
                    const totalComponents = totalInspections * (3 + Math.floor(Math.random() * 5));

                    performanceData.push({
                        timestamp: timestamp.toISOString(),
                        inspector: inspector,
                        total: totalInspections,
                        completed: completedInspections,
                        failed: failedInspections,
                        avg_time: avgInspectionTime,
                        components: totalComponents
                    });
                }
            }
        }

        // 検品パフォーマンス一括挿入
        for (const perf of performanceData) {
            await client.query(`
                INSERT INTO inspection_performance_hourly
                (hour_timestamp, inspector_name, total_inspections, completed_inspections,
                 failed_inspections, avg_inspection_time, total_components_scanned)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                perf.timestamp, perf.inspector, perf.total, perf.completed,
                perf.failed, perf.avg_time, perf.components
            ]);
        }

        // 5. モニタリングアラート生成
        const alertTypes = [
            { type: 'stockout_risk', severity: 'high', message: '在庫不足リスク: 7日以内に在庫切れの可能性' },
            { type: 'stockout_risk', severity: 'critical', message: '在庫不足警告: 3日以内に在庫切れの可能性' },
            { type: 'quality_degradation', severity: 'medium', message: '品質低下検出: 不良率が通常の1.5倍に上昇' },
            { type: 'performance_drop', severity: 'medium', message: '検品速度低下: 平均検品時間が20%増加' },
            { type: 'overstocked', severity: 'low', message: '過剰在庫警告: 90日分以上の在庫保有' }
        ];

        // 製品の一部にアラートを設定（3-5件）
        const alertCount = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < alertCount; i++) {
            const alert = alertTypes[i % alertTypes.length];
            const randomProduct = products[Math.floor(Math.random() * products.length)];
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            await client.query(`
                INSERT INTO monitoring_alerts
                (alert_type, severity, product_id, alert_message, alert_data, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                alert.type,
                alert.severity,
                randomProduct.id,
                `${randomProduct.product_name}: ${alert.message}`,
                JSON.stringify({ product_name: randomProduct.product_name }),
                expiresAt.toISOString()
            ]);
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'モニタリングサンプルデータを生成しました',
            data: {
                inventory_snapshots: inventorySnapshots.length,
                performance_records: performanceData.length,
                alerts: alertCount,
                products_used: products.length
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error generating monitoring sample data:', error);
        res.status(500).json({ error: 'Failed to generate sample data', details: error.message });
    } finally {
        client.release();
    }
});

// === データベース バックアップ・復元 API ===

// データベース全体のバックアップSQLを生成
app.get('/database/backup', async (req, res) => {
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
app.post('/database/restore', async (req, res) => {
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
app.get('/lot-inventory', async (req, res) => {
    try {
        const { product_id, status, lot_number } = req.query;
        let query = `
            SELECT li.*, p.product_code, p.product_name
            FROM lot_inventory li
            JOIN products p ON li.product_id = p.id
            WHERE 1=1
        `;
        const params = [];
        if (product_id) { params.push(product_id); query += ` AND li.product_id = $${params.length}`; }
        if (status)     { params.push(status);     query += ` AND li.status = $${params.length}`; }
        if (lot_number) { params.push(`%${lot_number}%`); query += ` AND li.lot_number ILIKE $${params.length}`; }
        query += ' ORDER BY li.product_id, li.lot_number';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching lot inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品別ロット在庫取得
app.get('/lot-inventory/by-product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await pool.query(`
            SELECT li.*, p.product_code, p.product_name
            FROM lot_inventory li
            JOIN products p ON li.product_id = p.id
            WHERE li.product_id = $1
            ORDER BY li.lot_number
        `, [productId]);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching lot inventory by product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロット在庫詳細取得
app.get('/lot-inventory/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT li.*, p.product_code, p.product_name
            FROM lot_inventory li
            JOIN products p ON li.product_id = p.id
            WHERE li.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Lot not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching lot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロット在庫登録
app.post('/lot-inventory', async (req, res) => {
    try {
        const { error, value } = Joi.object({
            product_id: Joi.number().integer().required(),
            lot_number: Joi.string().max(50).required(),
            quantity: Joi.number().integer().min(0).required(),
            manufacturing_date: Joi.date().iso().allow(null),
            expiry_date: Joi.date().iso().allow(null),
            location: Joi.string().max(100).allow('', null),
            notes: Joi.string().allow('', null)
        }).validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const result = await pool.query(`
            INSERT INTO lot_inventory (product_id, lot_number, quantity, manufacturing_date, expiry_date, location, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
        `, [value.product_id, value.lot_number, value.quantity, value.manufacturing_date || null,
            value.expiry_date || null, value.location || null, value.notes || null]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating lot:', error);
        if (error.code === '23505') return res.status(409).json({ error: '同一製品・ロット番号が既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロット在庫更新（入庫・調整）
app.patch('/lot-inventory/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, status, location, notes } = req.body;
        const result = await pool.query(`
            UPDATE lot_inventory
            SET quantity = COALESCE($1, quantity),
                status   = COALESCE($2, status),
                location = COALESCE($3, location),
                notes    = COALESCE($4, notes),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5 RETURNING *
        `, [quantity, status, location, notes, id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Lot not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating lot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === ピッキング API ===

// ピッキング指示作成（出荷指示を picking ステータスへ）
app.post('/picking-instructions', async (req, res) => {
    try {
        const { error, value } = Joi.object({
            shipping_instruction_id: Joi.number().integer().required(),
            picker_name: Joi.string().max(100).allow('', null),
            notes: Joi.string().allow('', null)
        }).validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { shipping_instruction_id, picker_name, notes } = value;

        const siResult = await pool.query(
            'SELECT * FROM shipping_instructions WHERE id = $1', [shipping_instruction_id]
        );
        if (siResult.rows.length === 0) return res.status(404).json({ error: '出荷指示が見つかりません' });

        const si = siResult.rows[0];
        if (!['pending'].includes(si.status)) {
            return res.status(409).json({ error: `ステータス ${si.status} の指示にはピッキング指示を作成できません` });
        }

        const pickingId = `PICK-${si.instruction_id}-${Date.now().toString().slice(-4)}`;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`
                INSERT INTO picking_instructions
                  (picking_id, shipping_instruction_id, picker_name, total_quantity, notes)
                VALUES ($1,$2,$3,$4,$5) RETURNING *
            `, [pickingId, shipping_instruction_id, picker_name || null, si.quantity, notes || null]);
            await client.query(
                `UPDATE shipping_instructions SET status='picking', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
                [shipping_instruction_id]
            );
            await client.query('COMMIT');
            res.status(201).json(result.rows[0]);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error creating picking instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ピッキング指示詳細（記録含む）
app.get('/picking-instructions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const piResult = await pool.query(`
            SELECT pi.*, si.instruction_id, si.customer_name, si.quantity as ordered_qty,
                   p.product_code, p.product_name
            FROM picking_instructions pi
            JOIN shipping_instructions si ON pi.shipping_instruction_id = si.id
            JOIN products p ON si.product_id = p.id
            WHERE pi.id = $1
        `, [id]);
        if (piResult.rows.length === 0) return res.status(404).json({ error: 'Picking instruction not found' });

        const records = await pool.query(`
            SELECT pr.*, li.location as lot_location
            FROM picking_records pr
            LEFT JOIN lot_inventory li ON pr.lot_inventory_id = li.id
            WHERE pr.picking_instruction_id = $1
            ORDER BY pr.scanned_at
        `, [id]);

        res.json({ picking: piResult.rows[0], records: records.rows });
    } catch (error) {
        logger.error('Error fetching picking instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ピッキング開始（ステータス: pending → in_progress）
app.patch('/picking-instructions/:id/start', async (req, res) => {
    try {
        const result = await pool.query(`
            UPDATE picking_instructions
            SET status='in_progress', started_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE id=$1 AND status='pending' RETURNING *
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found or already started' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error starting picking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロット QR スキャン（ピッキング記録）
app.post('/picking-instructions/:id/scan', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = Joi.object({
            lot_number: Joi.string().max(50).required(),
            picked_quantity: Joi.number().integer().min(1).default(1)
        }).validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { lot_number, picked_quantity } = value;

        // ピッキング指示取得
        const piResult = await pool.query(
            `SELECT pi.*, si.product_id FROM picking_instructions pi
             JOIN shipping_instructions si ON pi.shipping_instruction_id = si.id
             WHERE pi.id = $1`, [id]
        );
        if (piResult.rows.length === 0) return res.status(404).json({ error: 'Picking instruction not found' });
        const pi = piResult.rows[0];
        if (!['pending','in_progress'].includes(pi.status)) {
            return res.status(409).json({ error: `ステータス ${pi.status} のためスキャンできません` });
        }

        // ロット在庫確認
        const lotResult = await pool.query(
            `SELECT * FROM lot_inventory WHERE lot_number=$1 AND product_id=$2`,
            [lot_number, pi.product_id]
        );
        if (lotResult.rows.length === 0) {
            // エラー記録を保存
            await pool.query(`
                INSERT INTO picking_records (picking_instruction_id, lot_number, product_id, picked_quantity, status, error_message)
                VALUES ($1,$2,$3,$4,'error',$5)
            `, [id, lot_number, pi.product_id, picked_quantity, '対象製品のロットが見つかりません']);
            return res.json({ success: false, message: '対象製品のロットが見つかりません' });
        }

        const lot = lotResult.rows[0];
        if (lot.quantity < picked_quantity) {
            await pool.query(`
                INSERT INTO picking_records (picking_instruction_id, lot_number, product_id, picked_quantity, status, error_message)
                VALUES ($1,$2,$3,$4,'error',$5)
            `, [id, lot_number, pi.product_id, picked_quantity, `在庫不足 (在庫: ${lot.quantity})`]);
            return res.json({ success: false, message: `在庫不足です (在庫: ${lot.quantity})` });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // ピッキング記録
            const record = await client.query(`
                INSERT INTO picking_records (picking_instruction_id, lot_inventory_id, lot_number, product_id, picked_quantity, location)
                VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
            `, [id, lot.id, lot_number, pi.product_id, picked_quantity, lot.location]);

            // ピッキング済み数量を更新
            const newPicked = parseInt(pi.picked_quantity) + picked_quantity;
            await client.query(`
                UPDATE picking_instructions
                SET picked_quantity=$1, status='in_progress', updated_at=CURRENT_TIMESTAMP
                WHERE id=$2
            `, [newPicked, id]);

            await client.query('COMMIT');
            res.json({
                success: true,
                message: `ロット ${lot_number} をピッキングしました`,
                record: record.rows[0],
                picked_quantity: newPicked,
                total_quantity: pi.total_quantity
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error scanning lot for picking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ピッキング完了（出荷指示ステータス → packing）
app.patch('/picking-instructions/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const piResult = await pool.query(
            'SELECT * FROM picking_instructions WHERE id=$1', [id]
        );
        if (piResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const pi = piResult.rows[0];

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // ロット在庫を減算
            const records = await client.query(
                `SELECT lot_number, SUM(picked_quantity) as qty FROM picking_records
                 WHERE picking_instruction_id=$1 AND status='picked' GROUP BY lot_number`, [id]
            );
            for (const r of records.rows) {
                await client.query(
                    `UPDATE lot_inventory SET quantity = quantity - $1, updated_at=CURRENT_TIMESTAMP
                     WHERE lot_number=$2 AND quantity >= $1`,
                    [parseInt(r.qty), r.lot_number]
                );
            }
            await client.query(`
                UPDATE picking_instructions
                SET status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
                WHERE id=$1
            `, [id]);
            await client.query(
                `UPDATE shipping_instructions SET status='packing', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
                [pi.shipping_instruction_id]
            );
            await client.query('COMMIT');
            const updated = await pool.query('SELECT * FROM picking_instructions WHERE id=$1', [id]);
            res.json({ success: true, picking: updated.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error completing picking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 梱包 API ===

// 梱包記録作成（出荷指示ステータス packing で呼び出し）
app.post('/packing-records', async (req, res) => {
    try {
        const { error, value } = Joi.object({
            shipping_instruction_id: Joi.number().integer().required(),
            picking_instruction_id: Joi.number().integer().allow(null),
            packer_name: Joi.string().max(100).allow('', null),
            packed_quantity: Joi.number().integer().min(0).default(0),
            box_count: Joi.number().integer().min(1).default(1),
            total_weight_kg: Joi.number().min(0).allow(null),
            packaging_type: Joi.string().max(50).allow('', null),
            lot_numbers: Joi.string().allow('', null),
            notes: Joi.string().allow('', null)
        }).validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const result = await pool.query(`
            INSERT INTO packing_records
              (shipping_instruction_id, picking_instruction_id, packer_name, packed_quantity,
               box_count, total_weight_kg, packaging_type, lot_numbers, notes, status, started_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'in_progress',CURRENT_TIMESTAMP) RETURNING *
        `, [value.shipping_instruction_id, value.picking_instruction_id || null, value.packer_name || null,
            value.packed_quantity, value.box_count, value.total_weight_kg || null,
            value.packaging_type || null, value.lot_numbers || null, value.notes || null]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating packing record:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 梱包記録詳細取得
app.get('/packing-records/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pr.*, si.instruction_id, si.customer_name, p.product_code, p.product_name
            FROM packing_records pr
            JOIN shipping_instructions si ON pr.shipping_instruction_id = si.id
            JOIN products p ON si.product_id = p.id
            WHERE pr.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Packing record not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching packing record:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 梱包記録更新
app.patch('/packing-records/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { packer_name, packed_quantity, box_count, total_weight_kg, packaging_type, lot_numbers, notes } = req.body;
        const result = await pool.query(`
            UPDATE packing_records
            SET packer_name      = COALESCE($1, packer_name),
                packed_quantity  = COALESCE($2, packed_quantity),
                box_count        = COALESCE($3, box_count),
                total_weight_kg  = COALESCE($4, total_weight_kg),
                packaging_type   = COALESCE($5, packaging_type),
                lot_numbers      = COALESCE($6, lot_numbers),
                notes            = COALESCE($7, notes),
                updated_at       = CURRENT_TIMESTAMP
            WHERE id = $8 RETURNING *
        `, [packer_name, packed_quantity, box_count, total_weight_kg, packaging_type, lot_numbers, notes, id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Packing record not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating packing record:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 梱包完了（出荷指示ステータス → inspecting）
app.patch('/packing-records/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const { packed_quantity, box_count, total_weight_kg, packaging_type, lot_numbers, notes } = req.body;

        const prResult = await pool.query('SELECT * FROM packing_records WHERE id=$1', [id]);
        if (prResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const pr = prResult.rows[0];

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`
                UPDATE packing_records
                SET status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP,
                    packed_quantity  = COALESCE($1, packed_quantity),
                    box_count        = COALESCE($2, box_count),
                    total_weight_kg  = COALESCE($3, total_weight_kg),
                    packaging_type   = COALESCE($4, packaging_type),
                    lot_numbers      = COALESCE($5, lot_numbers),
                    notes            = COALESCE($6, notes)
                WHERE id = $7
            `, [packed_quantity, box_count, total_weight_kg, packaging_type, lot_numbers, notes, id]);
            await client.query(
                `UPDATE shipping_instructions SET status='inspecting', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
                [pr.shipping_instruction_id]
            );
            await client.query('COMMIT');
            const updated = await pool.query('SELECT * FROM packing_records WHERE id=$1', [id]);
            res.json({ success: true, packing: updated.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error completing packing:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示に紐づくPPS進捗一括取得
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
app.get('/system-config', (req, res) => {
    res.json(systemConfig);
});

// システム設定更新
app.patch('/system-config', (req, res) => {
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
