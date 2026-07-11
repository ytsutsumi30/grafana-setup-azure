/**
 * 共有 PostgreSQL 接続プール
 * server.js とルーターモジュールで同一プールを共有する。
 * SSL は DB_SSL=true のときのみ有効(ローカル PostgreSQL では無効)。
 * 証明書検証は既定で有効。自己署名証明書を使う開発環境だけ
 * DB_SSL_REJECT_UNAUTHORIZED=false を明示する。
 */
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'production_db',
    user: process.env.DB_USER || 'production_user',
    password: process.env.DB_PASSWORD || 'production_pass',
    ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
    } : false
});

module.exports = pool;
