# OpenID Connect 認証(Google / M365 両対応)設計検討

作成: 2026-07-06
対象: 出荷検品アプリ(grafana-setup-azure)。Google アカウントと Microsoft 365(Entra ID)アカウントの両方で OIDC ログインを実現する方式を比較検討する。

関連: docs/m365-delegated-auth.md(既存 M365 委任認証)、api/lib/auth.js(認証集約)、docs/tech-debt-execution-plan.md(Phase 0 で段階認証 WRITE_AUTH_MODE を導入済み)

## 現状(出発点)

- 認証は M365 委任認証(MSAL.js フロント + API が Microsoft Graph `/me` でトークン検証)。既定は無効(`M365_AUTH_ENABLED=false`)。
- API 側は `api/lib/auth.js` に集約済み:
  - `requireAdmin`(危険EP保護。M365 か `ADMIN_API_TOKEN`)
  - `writeAuth`(更新系の段階認証 `WRITE_AUTH_MODE=off|warn|enforce`)
  - `requiredAuth`(M365 required 時の全体強制)
- フロントは静的 HTML(nginx、外部公開)、API は内部 ingress、DB は Supabase。
- 現行 M365 検証はリクエストごとに Graph を叩く(60秒キャッシュあり)。Google 対応は未実装。

つまり「認証の受け皿」は整っているので、**複数プロバイダの ID を検証してアプリのユーザーに正規化する層**をどう用意するかが論点。

## 前提: OIDC で Google と M365 の両方は実現可能

- Google は OIDC 準拠(issuer: `https://accounts.google.com`)。
- Microsoft は Entra ID の共通エンドポイント(`https://login.microsoftonline.com/common` または特定テナント)で OIDC 準拠。M365 アカウントはこれで covers。
- どの方式でも、両プロバイダの ID トークンを検証し、`email` を軸にアプリ内ユーザーへ正規化する。

## 方式比較(3案)

### 案A: Supabase Auth を IdP ブローカーにする(推奨)

既に使っている Supabase の Auth 機能で Google と Azure(Microsoft)の OAuth/OIDC を有効化し、Supabase が発行する **単一の JWT** をアプリが検証する。

```text
Browser → Supabase Auth(Google / Azure を signInWithOAuth)
        → Supabase が JWT(access_token)を発行
        → フロントが /api 呼び出しに Bearer で付与
        → API は Supabase JWT を JWKS/JWT secret でローカル検証(Graph 不要)
```

- 両プロバイダ対応: Supabase は Google・Azure(Microsoft)を組み込みでサポート。Azure は特定テナント URL 指定も可能。
- 実装量: 中。フロントに `@supabase/supabase-js` を追加し `signInWithOAuth({provider})`、API は既存 `lib/auth.js` に「Supabase JWT 検証」関数を追加して `validateM365Token` を置換/併存。
- 既存資産との親和: 高。`WRITE_AUTH_MODE` / `requireAdmin` の枠組みをそのまま使い、検証部だけ差し替え。ユーザーは Supabase `auth.users` に集約され、検品者マスタ(inspectors)との紐付けや RBAC の土台になる。
- ローカル開発: Supabase プロジェクトに対して動くため docker 単体では要工夫(dev 用に検証スキップ or ローカル Supabase)。
- 注意: Azure(Microsoft)プロバイダは有効な email を返す必要がある。DB は従来どおりサーバー側 pg でよい(Supabase Auth は認証のみに使用)。

### 案B: Azure Container Apps 組み込み認証(Easy Auth)

ACA のプラットフォーム認証を有効化。Microsoft Entra ID と Google(および任意の OIDC プロバイダ)を追加すると、ingress 手前で OIDC を処理し、アプリにはヘッダ(`X-MS-CLIENT-PRINCIPAL`)で ID を渡す。

```text
Browser → web(外部 ingress、Easy Auth)
        → 未認証は Google/Microsoft のログインへリダイレクト
        → 認証済みはヘッダに ID を注入して web→api へ
```

- 両プロバイダ対応: Entra ID・Google を組み込みでサポート。カスタム OIDC も可。
- 実装量: 最小(アプリのコード変更ほぼ不要)。全体ログインウォールとして最短。
- 既存資産との親和: 中〜低。Easy Auth は Cookie/ヘッダ方式で、現行の Bearer トークン + `WRITE_AUTH_MODE`(per-endpoint 検証)とは思想が異なる。per-role 制御やアプリ内ユーザー紐付けは別途ヘッダ解釈が必要。
- ローカル開発: Easy Auth は docker 単体には無いため、dev バイパス(WRITE_AUTH_MODE=off)で回避。
- 向き: 「社員全員に SSO の壁を1枚かける」用途に最適。細かい権限やユーザー識別を app 側で作り込むなら案A/Cが優る。

### 案C: アプリ自前 OIDC(openid-client)

Node の `openid-client` で Authorization Code Flow + PKCE を実装。Google と Microsoft(common)の2 issuer を discovery で登録し、コールバックで ID トークンを JWKS 検証、アプリのセッション Cookie か自前 JWT を発行。

- 両プロバイダ対応: issuer を2つ登録するだけ。最大の自由度。
- 実装量: 大。セッション/Cookie セキュリティ、CSRF(state/nonce)、トークン更新、ログアウトを自前管理。
- 既存資産との親和: 高(lib/auth.js に自然に載る)が、作り込みと保守コストが最も大きい。
- 向き: プラットフォーム/SaaS に依存したくない、要件が特殊な場合。

## 比較表

| 観点 | 案A Supabase Auth | 案B ACA Easy Auth | 案C 自前 openid-client |
|------|-------------------|-------------------|------------------------|
| Google + M365 | ○ 組み込み | ○ 組み込み | ○ issuer 2つ |
| 実装量 | 中 | 最小 | 大 |
| 既存 lib/auth.js との親和 | 高 | 中〜低 | 高 |
| ユーザー識別・RBAC 土台 | 強(auth.users) | 弱(ヘッダ解釈) | 中(自前) |
| ローカル docker 開発 | 要工夫 | 不可(dev回避) | 可 |
| 運用・保守 | Supabase 管理 | Azure 管理 | 自前保守 |
| 既存 Supabase 活用 | ◎ | × | × |
| ベンダーロック | Supabase | Azure | なし |

## 推奨: 案A(Supabase Auth)

理由:
- Supabase を既に採用しており、Google・M365 の両 OIDC を追加コストなく賄える。
- アプリは Supabase の単一 JWT をローカル検証するだけでよく、現行の Graph `/me` 呼び出し(遅延・外部依存)を廃止して統一できる。
- `WRITE_AUTH_MODE` / `requireAdmin` の段階導入設計をそのまま活かし、検証関数の差し替えで移行できる(既存の Phase 0 セキュリティ資産を捨てない)。
- `auth.users` を軸に検品者(inspectors)との紐付け・管理者ロールへ発展でき、将来の RBAC・監査表示につながる。

「まず全体に SSO の壁を最短で」だけが目的なら案B(Easy Auth)が最速。細かい権限や現場ユーザー識別まで見据えるなら案A。

## 案A 実装アウトライン(採用時)

1. Supabase ダッシュボードで Auth プロバイダを有効化: Google(OAuth クライアント)+ Azure(Entra アプリ登録、必要なら特定テナント)。リダイレクト URL に web の公開 URL を登録。
2. フロント: `@supabase/supabase-js` を vendor 追加。ログイン画面に「Google でログイン」「Microsoft でログイン」を用意し `supabase.auth.signInWithOAuth({ provider: 'google' | 'azure' })`。取得した `access_token` を `/api` 呼び出しの `Authorization: Bearer` に付与(既存 m365-auth.js を置換/共通化)。
3. API `lib/auth.js`: `validateSupabaseToken(token)` を追加(Supabase の JWT secret / JWKS で検証、`email`・`sub`・ロールを取り出す)。`requireAdmin` / `writeAuth` / `requiredAuth` の検証部をこれに切替(M365 直検証は段階的に廃止 or フォールバック併存)。
4. 認可: `email` ドメイン許可リスト(既存 `allowedDomains` 相当)+ 管理者判定(Supabase のユーザーメタデータ or 専用テーブル)。
5. 段階移行: `WRITE_AUTH_MODE=warn` で観測 → `enforce`。危険EPは `requireAdmin` のまま。
6. ローカル開発: dev では `WRITE_AUTH_MODE=off` で従来どおり動作(認証なし)。

## セキュリティ考慮

- ID トークン/JWT はローカル検証(JWKS or 署名鍵)し、有効期限・issuer・audience を必ず検証。
- `email` は検証済み(email_verified)であることを確認してから許可判定に使う。
- リダイレクト URL の allowlist、state/nonce(案C の場合)で CSRF/リプレイ対策。
- トークンはフロントで安全に扱う(XSS 対策。可能なら短命 access + サイレント更新)。
- 管理者権限(requireAdmin)はメール一致だけでなく明示的な管理者リストで管理。
- Grafana 埋め込み(別計画)とは認証境界を分離(Grafana は internal + nginx 経由のまま)。

## 未決事項(実装前に確定したい)

- 目的の主眼: 「全体 SSO ログインウォール」か「ユーザー個別識別 + 権限(検品者紐付け・管理者)」か。→ 前者なら案B も有力、後者なら案A。
- 許可範囲: 社内ドメインのみ(例: @会社.co.jp)に限定するか、Google の任意アカウントも許可するか。
- テナント: Microsoft 側は特定テナント限定か、共通(personal 含む)か。
- ユーザー↔検品者(inspectors)の紐付けを今回スコープに含めるか。

## 後回し候補

- ロールベースアクセス制御(RBAC)の本格化
- SCIM/自動プロビジョニング
- 多要素認証(MFA)ポリシー(各 IdP 側設定に委譲)
- Grafana との SSO 統合

---

# 決定と実装計画(2026-07-06 更新)

## 決定

- 目的: **全体 SSO ログインウォール**(社員なら入れる壁を1枚)。
- 許可範囲: **Google は任意アカウント許可 + M365 は社内テナント限定**。
- 上記より **採用方式 = 案B(Azure Container Apps 組み込み認証 / Easy Auth)** を主軸とする。
  最短でウォールを実現でき、Entra ID(単一テナント)と Google を組み込みで扱える。

## 重要な注意(セキュリティ設計上の前提)

「Google 任意アカウント許可」= **Gmail を持つ誰でもウォールを通過できる**ことを意味する。
したがってウォール(Easy Auth)は「本人確認」はできても「社外遮断」にはならない。
これを踏まえ、次の二層構成にする。

```text
第1層: Easy Auth(ウォール)   … 未ログインを弾く。Google/M365 でサインイン
第2層: アプリ内の認可          … 危険操作・更新系は既存の requireAdmin / WRITE_AUTH_MODE で別途保護
```

- 参照(GET)は壁を通れば許可。
- 破壊的操作(/database/*・/logs/*・sample-data)は既存 `requireAdmin`(ADMIN_API_TOKEN or 管理者)で継続保護。
- 更新系(POST/PUT/PATCH/DELETE)は `WRITE_AUTH_MODE` を段階的に enforce へ。
- 「社外遮断」を将来強めたくなったら、M365 は単一テナントで限定済みなので、Google 側を
  ドメイン allowlist(第2層のミドルウェアで principal の email ドメイン判定)で絞れる。

## 実装ステップ(案B)

### 1. IdP 登録

- Microsoft(Entra ID): アプリ登録を作成し、**単一テナント**(社内)に設定。リダイレクト URI に
  `https://<web公開URL>/.auth/login/aad/callback` を登録。
- Google: Google Cloud で OAuth クライアントを作成。承認済みリダイレクト URI に
  `https://<web公開URL>/.auth/login/google/callback` を登録。任意アカウント許可なのでドメイン制限なし。

### 2. Azure Container Apps の認証を有効化(Terraform)

`infra/terraform` に web コンテナアプリの `auth_config` を追加(概念例):

```hcl
# 未認証は 302 でログインへ(ウォール化)
# global validation: unauthenticated_action = "RedirectToLoginPage"
# identity_providers:
#   - azure_active_directory(single tenant, client_id/secret を secret 参照)
#   - google(client_id/secret を secret 参照)
```

- 認証はクライアントシークレットを Container Apps secrets / Key Vault 経由で渡す。
- API(internal)は web 経由でのみ到達するため、ウォールは web 側で成立。

### 3. アプリ側の薄い連携(コード最小)

- Easy Auth は認証済みリクエストに `X-MS-CLIENT-PRINCIPAL`(base64 JSON)を注入する。
  必要に応じて `api/lib/auth.js` に `readEasyAuthPrincipal(req)` を追加し、email/プロバイダを取得。
- 第2層の allowlist を使う場合のみ、`requiredAuth` 相当を「principal の email ドメイン判定」に差し替え。
  単純なウォールだけなら **アプリのコード変更は不要**。
- ログイン/ログアウト導線: フロントに「ログイン」= `/.auth/login/aad` `/.auth/login/google`、
  「ログアウト」= `/.auth/logout` のリンクを用意(Easy Auth の標準エンドポイント)。
- 既存 M365(MSAL)フロント実装(js/m365-auth.js)は Easy Auth 化に伴い不要化 → 段階的に撤去。

### 4. ローカル開発

- Easy Auth は docker 単体には無い。dev では従来どおり無認証で動かす
  (`WRITE_AUTH_MODE=off`、ウォール無し)。本番/ステージングのみウォール有効。
- スモーク/コントラクトはローカル(ウォール無し)前提を維持。

### 5. 段階移行

1. ステージングで Easy Auth 有効化 → Google/M365 双方でログイン確認。
2. `WRITE_AUTH_MODE=warn` で未認証書き込みを観測 → `enforce`。
3. 危険EPの `ADMIN_API_TOKEN` を本番 secret に設定。
4. 本番へ反映、既存 MSAL フロントを撤去。

## 完成条件(案B)

```text
本番/ステージングで未ログイン時にログイン画面へリダイレクトされる。
Google 任意アカウントでログインできる。
M365 は社内テナントのアカウントのみログインできる。
ログイン後、参照系が利用でき、危険EPは引き続き 403(管理者のみ)。
ローカル docker は従来どおり無認証で動作しスモーク/コントラクトが緑。
```

## 実装の役割分担

- **Azure/IdP 側(手動 or Terraform)**: Entra/Google アプリ登録、リダイレクト URI、
  Container Apps auth 設定、secrets。→ Azure 権限が必要なため利用者側で実施。
- **アプリ側(コードで対応可)**: ログイン/ログアウト導線、(必要なら)principal 読取り +
  ドメイン allowlist ミドルウェア、MSAL フロントの撤去。→ WSL リポジトリで実装可能。

---

# 最終決定: 案C(自前 OIDC)を採用・実装済み(2026-07-06)

Azure Container Apps のプラットフォーム権限を使わない方針となったため、**案C(アプリ内完結の
自前 OIDC SSO ウォール)を採用・実装した**。案B(Easy Auth)は不採用。詳細な実装記録は
WSL リポジトリ側 docs/auth-oidc-plan.md の「実装(案C 採用)」節を参照(正本)。

## 実装物(WSL リポジトリ grafana-setup-azure)
- api/lib/oidc.js: openid-client(v5)で Google / Microsoft を Authorization Code + PKCE。
  署名付き JWT を HttpOnly Cookie に格納(共有ストア不要)。認可: Microsoft=許可、
  Google=GOOGLE_ALLOWED_DOMAINS 設定時のみ制限(空=任意許可)。
- api/server.js: /auth/whoami・/auth/login/:provider・/auth/callback/:provider・/auth/logout、
  ウォール(AUTH_WALL=on かつ SESSION_SECRET+プロバイダ設定時のみ有効。既定 off)。
- web/login.html + web/js/layout.js: プロバイダ選択画面、未認証時の login 誘導、user+ログアウト。
- docker-compose: AUTH_WALL / SESSION_SECRET / PUBLIC_BASE_URL / GOOGLE_* / MS_* を環境変数化。
- tests: oidc.unit.test.js(6件)+ 既存コントラクト28件 + スモーク、すべて緑。

## 必要な IdP 登録(Azure Container Apps 権限は不要)
- Google(Google Cloud): OAuth クライアント。リダイレクト URI
  `https://<web公開URL>/api/auth/callback/google`。
- Microsoft(Entra ID): アプリ登録(単一テナント=社内)。リダイレクト URI
  `https://<web公開URL>/api/auth/callback/microsoft`。MS_TENANT_ID=社内テナントID。

## 本番有効化
1. SESSION_SECRET(強いランダム)・PUBLIC_BASE_URL を設定。
2. GOOGLE_* / MS_* に登録済み Client ID/Secret/Tenant を設定(Container Apps secrets)。
3. AUTH_WALL=on。危険EPは requireAdmin、更新系は WRITE_AUTH_MODE で二層防御(据え置き)。

## 完成条件(案C・達成状況)
```text
[済] ウォール有効時、未認証の /api/* は 401、health/auth は素通り。
[済] login/google が Google authorize へ 302(discovery 成功)。
[済] 有効セッションで whoami=authenticated、/api/*=200。
[済] Google はドメイン制限を設定時のみ適用(空=任意許可)、Microsoft は許可。
[済] ローカル docker は既定 off で従来どおり無認証・スモーク/コントラクト緑。
[要・利用者] Entra/Google のアプリ登録と本番 secrets 設定 → AUTH_WALL=on。
```
