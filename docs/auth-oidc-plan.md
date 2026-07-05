
---

# 実装(案C 採用・2026-07-06)

Azure Container Apps の権限を使わず、アプリ内で完結する SSO ウォールを実装した。

## 実装物
- api/lib/oidc.js: openid-client(v5)で Google / Microsoft を Authorization Code + PKCE。
  セッションは署名付き JWT を HttpOnly Cookie に格納(共有ストア不要)。state/nonce/verifier は
  短命の署名 Cookie。認可 isAllowed(Microsoft=許可、Google=GOOGLE_ALLOWED_DOMAINS 設定時のみ制限)。
- api/server.js: cookie-parser 有効化、/auth/whoami・/auth/login/:provider・/auth/callback/:provider・
  /auth/logout、ウォール(oidc.wall、AUTH_WALL=on かつ SESSION_SECRET+プロバイダ設定時のみ)。
- web/login.html: プロバイダ選択画面(whoami の providers で出し分け)。
- web/js/layout.js: whoami 連動。ウォール有効かつ未認証は login.html へ誘導、認証済みは user+ログアウト。
- docker-compose: AUTH_WALL / SESSION_SECRET / PUBLIC_BASE_URL / GOOGLE_* / MS_* を環境変数化(既定 off)。
- tests/api/oidc.unit.test.js: 認可・ウォール判定の単体テスト(6件)。

## 必要な IdP 登録(Azure Container Apps 権限は不要)
- Google: Google Cloud で OAuth クライアント作成。承認済みリダイレクト URI に
  `https://<web公開URL>/api/auth/callback/google`。ドメイン制限なし(任意許可)。
- Microsoft(Entra ID): アプリ登録(単一テナント=社内)。リダイレクト URI に
  `https://<web公開URL>/api/auth/callback/microsoft`。MS_TENANT_ID に社内テナントID。
- どちらも Client ID/Secret を Container Apps secrets 経由で環境変数に渡す。

## 本番有効化手順
1. SESSION_SECRET(強いランダム値)と PUBLIC_BASE_URL を設定。
2. GOOGLE_* / MS_* に登録済みの Client ID/Secret/Tenant を設定。
3. AUTH_WALL=on にする(SESSION_SECRET+プロバイダが揃って初めて有効)。
4. 危険EPは既存 requireAdmin、更新系は WRITE_AUTH_MODE で二層防御(据え置き)。

## 検証済み(ローカル)
- 未設定: whoami authenticated:false / wallEnabled:false、login=503、既存挙動不変、スモークALL PASS。
- ウォール有効(ダミー設定): 未認証 /api/* =401、health/auth は素通り、login/google=302(Google へ)、
  有効セッションCookieで whoami authenticated:true・/api/*=200。
- 単体テスト6/6、コントラクト28/28、スモークALL PASS。

## ローカル開発
- 既定(AUTH_WALL 未設定 or off)は従来どおり無認証で動作。ウォールは本番/ステージングのみ。
