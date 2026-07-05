/**
 * 自前 OIDC(案C): Google と Microsoft(M365 テナント)を Authorization Code + PKCE で扱う。
 * Azure Container Apps のプラットフォーム認証には依存しない。アプリ内で完結。
 *
 * セッションはステートレスな署名付き JWT を HttpOnly Cookie に格納(Container Apps の
 * 水平スケールでも共有ストア不要)。ログイン時の一時状態(state/nonce/code_verifier)は
 * 短命の署名付き Cookie に入れる。
 *
 * 必要な環境変数(設定が無いプロバイダはログイン不可、その旨 503):
 *   PUBLIC_BASE_URL           例 https://<web公開URL>(コールバック URL 構築に使用)
 *   SESSION_SECRET            セッション JWT 署名鍵(必須。未設定なら wall は無効化)
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   MS_CLIENT_ID / MS_CLIENT_SECRET / MS_TENANT_ID(社内テナント。common も可)
 *   GOOGLE_ALLOWED_DOMAINS    任意。設定時のみ Google をドメインで制限(空=任意許可)
 */
const jwt = require('jsonwebtoken');
const { Issuer, generators } = require('openid-client');

const COOKIE_SESSION = 'prj3_session';
const COOKIE_FLOW = 'prj3_oidc_flow';

module.exports = function createOidc(logger) {
  const SESSION_SECRET = process.env.SESSION_SECRET || '';
  const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const googleAllowed = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

  const providerConf = {
    google: {
      enabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      issuer: 'https://accounts.google.com',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      scope: 'openid email profile'
    },
    microsoft: {
      enabled: Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET),
      issuer: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID || 'common'}/v2.0`,
      clientId: process.env.MS_CLIENT_ID,
      clientSecret: process.env.MS_CLIENT_SECRET,
      scope: 'openid email profile'
    }
  };

  const clients = {}; // provider -> openid-client Client(遅延初期化)

  function redirectUri(provider) {
    // ブラウザからは /api/auth/... で到達(nginx が /api/ を API へプロキシ)
    return `${PUBLIC_BASE_URL}/api/auth/callback/${provider}`;
  }

  async function getClient(provider) {
    const conf = providerConf[provider];
    if (!conf || !conf.enabled) return null;
    if (clients[provider]) return clients[provider];
    const issuer = await Issuer.discover(conf.issuer);
    clients[provider] = new issuer.Client({
      client_id: conf.clientId,
      client_secret: conf.clientSecret,
      redirect_uris: [redirectUri(provider)],
      response_types: ['code']
    });
    return clients[provider];
  }

  // ---- セッション ----
  function issueSession(user) {
    // 8時間有効。最小限の主張のみ。
    return jwt.sign(
      { sub: user.sub, email: user.email, name: user.name, provider: user.provider },
      SESSION_SECRET,
      { expiresIn: '8h' }
    );
  }
  function readSession(req) {
    if (!SESSION_SECRET) return null;
    const token = (req.cookies && req.cookies[COOKIE_SESSION]) || '';
    if (!token) return null;
    try { return jwt.verify(token, SESSION_SECRET); } catch (e) { return null; }
  }
  function sessionCookieOptions() {
    const secure = PUBLIC_BASE_URL.startsWith('https://');
    return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 8 * 3600 * 1000 };
  }

  // ---- 認可(許可判定) ----
  function isAllowed(user) {
    // Microsoft はテナントを issuer で限定済み → 許可。
    if (user.provider === 'microsoft') return true;
    // Google はドメイン制限が設定されている場合のみ絞る(空=任意許可)。
    if (user.provider === 'google') {
      if (!googleAllowed.length) return true;
      const domain = (user.email || '').includes('@') ? user.email.split('@').pop() : '';
      return googleAllowed.includes(domain);
    }
    return false;
  }

  // ---- ルートハンドラ ----
  async function login(req, res) {
    const provider = req.params.provider;
    try {
      const client = await getClient(provider);
      if (!client) {
        return res.status(503).json({ error: `${provider} login is not configured` });
      }
      const code_verifier = generators.codeVerifier();
      const code_challenge = generators.codeChallenge(code_verifier);
      const state = generators.state();
      const nonce = generators.nonce();
      const redirectAfter = typeof req.query.redirect === 'string' ? req.query.redirect : '/index.html';

      // 一時状態を短命の署名 Cookie に格納(サーバーステート不要)
      const flowToken = jwt.sign({ provider, code_verifier, state, nonce, redirectAfter },
        SESSION_SECRET, { expiresIn: '10m' });
      res.cookie(COOKIE_FLOW, flowToken, { httpOnly: true, sameSite: 'lax',
        secure: PUBLIC_BASE_URL.startsWith('https://'), path: '/', maxAge: 10 * 60 * 1000 });

      const url = client.authorizationUrl({
        scope: providerConf[provider].scope,
        code_challenge, code_challenge_method: 'S256', state, nonce
      });
      return res.redirect(url);
    } catch (err) {
      logger.error('oidc login error', { provider, err: err.message });
      return res.status(500).json({ error: 'Login failed to start' });
    }
  }

  async function callback(req, res) {
    const provider = req.params.provider;
    try {
      const client = await getClient(provider);
      if (!client) return res.status(503).json({ error: 'provider not configured' });
      const flowRaw = (req.cookies && req.cookies[COOKIE_FLOW]) || '';
      if (!flowRaw) return res.status(400).json({ error: 'missing flow state' });
      let flow;
      try { flow = jwt.verify(flowRaw, SESSION_SECRET); } catch (e) {
        return res.status(400).json({ error: 'invalid flow state' });
      }
      res.clearCookie(COOKIE_FLOW, { path: '/' });

      const params = client.callbackParams(req);
      const tokenSet = await client.callback(redirectUri(provider), params, {
        code_verifier: flow.code_verifier, state: flow.state, nonce: flow.nonce
      });
      const claims = tokenSet.claims();
      const email = (claims.email || claims.preferred_username || '').toLowerCase();
      const user = { sub: claims.sub, email, name: claims.name || email, provider };

      if (claims.email && claims.email_verified === false) {
        return res.status(403).send('Email not verified');
      }
      if (!isAllowed(user)) {
        logger.warn('oidc user not permitted', { provider, email });
        return res.status(403).send('このアカウントはアクセスを許可されていません');
      }

      res.cookie(COOKIE_SESSION, issueSession(user), sessionCookieOptions());
      const dest = (flow.redirectAfter && flow.redirectAfter.startsWith('/')) ? flow.redirectAfter : '/index.html';
      return res.redirect(dest);
    } catch (err) {
      logger.error('oidc callback error', { provider, err: err.message });
      return res.status(500).send('Authentication failed');
    }
  }

  function logout(req, res) {
    res.clearCookie(COOKIE_SESSION, { path: '/' });
    const dest = (typeof req.query.redirect === 'string' && req.query.redirect.startsWith('/'))
      ? req.query.redirect : '/index.html';
    return res.redirect(dest);
  }

  function whoami(req, res) {
    const user = readSession(req);
    res.json({
      authenticated: Boolean(user),
      wallEnabled: wallEnabled(),
      providers: { google: providerConf.google.enabled, microsoft: providerConf.microsoft.enabled },
      user: user ? { email: user.email, name: user.name, provider: user.provider } : null
    });
  }

  // ---- ウォール ----
  function wallEnabled() {
    // SESSION_SECRET と少なくとも1プロバイダがあり、AUTH_WALL=on のとき有効。
    return process.env.AUTH_WALL === 'on' && Boolean(SESSION_SECRET) &&
      (providerConf.google.enabled || providerConf.microsoft.enabled);
  }
  function wall(req, res, next) {
    if (!wallEnabled()) return next();
    if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
    const user = readSession(req);
    if (!user) return res.status(401).json({ error: 'Authentication required', login: '/login.html' });
    req.user = user;
    return next();
  }

  return { login, callback, logout, whoami, wall, wallEnabled, readSession, isAllowed };
};
