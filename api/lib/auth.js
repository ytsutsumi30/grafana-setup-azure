/**
 * 認証モジュール(M365 委任認証 + 管理者トークン + 段階的書き込み認証)
 * server.js から抽出。振る舞いは不変。logger を注入する。
 *
 *   const auth = require('./lib/auth')(logger);
 *   auth.requireAdmin   … 危険EP保護ミドルウェア
 *   auth.writeAuth      … 更新系(POST/PUT/PATCH/DELETE)の段階認証(WRITE_AUTH_MODE)
 *   auth.requiredAuth   … M365 required 時の全体強制ミドルウェア
 *   auth.m365AuthConfig / getBearerToken / validateM365Token … /auth ルート用
 */
const crypto = require('crypto');

module.exports = function createAuth(logger) {
  const isProduction = process.env.NODE_ENV === 'production';
  const configuredWriteAuthMode = process.env.WRITE_AUTH_MODE;
  const writeAuthMode = (configuredWriteAuthMode || (isProduction ? 'enforce' : 'off')).toLowerCase();
  const adminApiToken = process.env.ADMIN_API_TOKEN || '';
  if (!['off', 'warn', 'enforce'].includes(writeAuthMode)) {
    throw new Error('WRITE_AUTH_MODE must be one of: off, warn, enforce');
  }

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

  // 管理者専用エンドポイント保護ミドルウェア。
  // M365 有効時は M365 ユーザーを要求、無効時は ADMIN_API_TOKEN(x-admin-token)。
  // どちらも未設定なら安全側に倒して 403(既定オフ)。
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
      if (adminApiToken) {
        const provided = req.get('x-admin-token') || '';
        const a = Buffer.from(provided);
        const b = Buffer.from(adminApiToken);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          return next();
        }
        return res.status(401).json({ error: 'Unauthorized' });
      }
      logger.warn('Admin endpoint blocked: no M365 auth and no ADMIN_API_TOKEN configured', {
        path: req.originalUrl
      });
      return res.status(403).json({ error: 'This endpoint is disabled (no admin auth configured)' });
    } catch (err) {
      logger.error('requireAdmin error', { err: err.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const WRITE_AUTH_EXEMPT = []; // 認証不要の更新系パス(現状なし)

  async function resolveAuthenticatedUser(req) {
    if (m365AuthConfig.enabled) {
      const user = await validateM365Token(getBearerToken(req));
      return user || null;
    }
    if (adminApiToken) {
      const provided = req.get('x-admin-token') || '';
      const a = Buffer.from(provided);
      const b = Buffer.from(adminApiToken);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { id: 'admin-token', displayName: 'Admin (token)' };
      }
    }
    return null;
  }

  // 更新系の段階認証。production で未指定なら enforce、それ以外は off。
  async function writeAuth(req, res, next) {
    if (!WRITE_METHODS.has(req.method)) return next();
    const mode = writeAuthMode;
    if (mode === 'off') return next();
    if (WRITE_AUTH_EXEMPT.some((p) => req.path.startsWith(p))) return next();
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
      return res.status(401).json({ error: 'Unauthorized' });
    } catch (err) {
      logger.error('write-auth middleware error', { err: err.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // M365 required 時に全体を強制するミドルウェア(health / auth は除外)。
  async function requiredAuth(req, res, next) {
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
  }

  return {
    m365AuthConfig,
    getBearerToken,
    validateM365Token,
    requireAdmin,
    writeAuth,
    requiredAuth,
    writeAuthMode,
    validateProductionConfiguration() {
      if (!isProduction || writeAuthMode !== 'enforce') return [];
      if (m365AuthConfig.enabled || adminApiToken.length >= 32) return [];
      return ['WRITE_AUTH_MODE=enforce requires configured M365 authentication or an ADMIN_API_TOKEN of at least 32 characters'];
    }
  };
};
