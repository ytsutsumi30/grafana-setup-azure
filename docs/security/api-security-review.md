# API セキュリティレビュー: api/server.js

作成: 2026-07-06 / ブランチ: chore/debt-p0-security / スキル: security-best-practices
参照: .claude/skills/security-best-practices/references/javascript-express-web-server-security.md
方針: パッチは**提案のみ**(適用は承認後)。行番号は現行 server.js(5,691 行)基準。

## サマリー

| 重大度 | 件数 | ID |
|---|---|---|
| Critical | 3 | S1, S2, S3 |
| High | 3 | S4, S5, S6 |
| Medium | 3 | S7, S8, S9 |
| Low | 2 | S10, S11 |

---

## S1 [Critical] /database/restore が無認証で任意 SQL を実行
- 該当: api/server.js:5072-5110
- 問題: `req.body.sql` を `client.query(sql)` にそのまま渡す。認証なし。攻撃者が任意の DDL/DML を実行でき、データの破壊・全件窃取・改ざんが可能。
- 修正案(最小): 本番では機能を無効化し、有効化する場合も管理者認証を必須化。

```diff
+// エンドポイント有効化フラグ(既定オフ)
+const DANGEROUS_OPS_ENABLED = process.env.ENABLE_DB_OPS === 'true';
+
-app.post('/database/restore', async (req, res) => {
+app.post('/database/restore', requireAdmin, async (req, res) => {
+    if (!DANGEROUS_OPS_ENABLED) {
+        return res.status(403).json({ error: 'This endpoint is disabled' });
+    }
     const client = await pool.connect();
```

- 恒久対策(推奨): 任意 SQL 実行は廃止し、スキーマ適用は scripts/apply-supabase-schema.sh 経由に限定(脅威モデル M4)。

## S2 [Critical] /database/backup が無認証 + exec 文字列連結
- 該当: api/server.js:4919、3293-3295
- 問題: 認証なしで DB 全件 dump 可能(機密性)。さらに `exec("PGPASSWORD=\"${dbPassword}\" pg_dump ... > ${backupPath}")` は shell 文字列連結で、将来 backupPath 等に入力が混ざると OS コマンドインジェクション。Container Apps の FS は揮発性で backup は永続化されない副次問題もある。
- 修正案: 認証必須化 + フラグ化 + execFile で引数分離。

```diff
-app.get('/database/backup', async (req, res) => {
+app.get('/database/backup', requireAdmin, async (req, res) => {
+    if (!DANGEROUS_OPS_ENABLED) return res.status(403).json({ error: 'disabled' });
...
-        const command = `PGPASSWORD="${dbPassword}" pg_dump -h ${dbHost} -U ${dbUser} -d ${dbName} > ${backupPath}`;
-        await execPromise(command);
+        const { execFile } = require('child_process');
+        const execFileP = util.promisify(execFile);
+        const out = fs.openSync(backupPath, 'w');
+        await execFileP('pg_dump', ['-h', dbHost, '-U', dbUser, '-d', dbName], {
+            env: { ...process.env, PGPASSWORD: dbPassword },
+            stdio: ['ignore', out, 'inherit']
+        });
```

## S3 [Critical] 認証境界が存在しない(全 /api が無認証)
- 該当: api/server.js:152-153 付近(グローバルミドルウェア)。認証を強制する `app.use` なし。M365 は `M365_AUTH_REQUIRED`(既定 false)。
- 問題: products/shipping-instructions/inventory/inspectors など全エンドポイントが無認証。参照・改ざん・なりすまし登録が可能。
- 修正案: 認証ミドルウェアを追加し、更新系と管理系に必須化。既存の validateM365Token を活用。

```diff
+// 認証ミドルウェア(M365 有効時はトークン検証、必須時は 401)
+async function requireAuth(req, res, next) {
+    if (!m365AuthConfig.required) return next(); // POC 移行期は required で制御
+    const user = await validateM365Token(getBearerToken(req));
+    if (!user) return res.status(401).json({ error: 'Unauthorized' });
+    req.user = user;
+    next();
+}
+function requireAdmin(req, res, next) {
+    return requireAuth(req, res, () => {
+        // 管理者判定(allowedDomains 内 or 管理者リスト)。POC では requireAuth と同等
+        next();
+    });
+}
+
+// 更新系・管理系に適用(段階導入)。まず全 POST/PUT/PATCH/DELETE に:
+app.use((req, res, next) => {
+    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) return requireAuth(req, res, next);
+    next();
+});
```

- 段階導入: (1) 危険エンドポイント(S1/S2/S5)を requireAdmin、(2) 全更新系を requireAuth、(3) 本番で M365_AUTH_REQUIRED=true を既定化。

## S4 [High] CORS が全オリジン許可
- 該当: api/server.js:153 `app.use(cors())`
- 修正案:

```diff
-app.use(cors());
+const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
+app.use(cors({
+    origin: allowedOrigins.length ? allowedOrigins : false,
+    credentials: true
+}));
```

- 同一オリジン(nginx 経由)運用なら `origin: false`(クロスオリジン拒否)でも動作する。

## S5 [High] /logs/files・/logs/content が無認証で運用ログを開示
- 該当: api/server.js:3399 ほか。filename allowlist はあり(path traversal は緩和済)だが認証なし。
- 問題: IP・リクエストパス・エラースタックなど運用情報が外部から閲覧可能。偵察に利用される。
- 修正案: requireAdmin を付与。将来的に winston をコンソール出力へ寄せ、ログ閲覧は Log Analytics/Grafana に移譲。

```diff
-app.get('/logs/files', async (req, res) => {
+app.get('/logs/files', requireAdmin, async (req, res) => {
-app.get('/logs/content/:filename', async (req, res) => {
+app.get('/logs/content/:filename', requireAdmin, async (req, res) => {
```

## S6 [High] sample-data 生成が無認証(本番 DB 汚染)
- 該当: /qc-tools/generate-sample-data、/monitoring/generate-sample-data
- 修正案: requireAdmin + DANGEROUS_OPS_ENABLED フラグ。本番では既定オフ。

## S7 [Medium] エラー詳細をレスポンスに返却
- 該当: api/server.js:3312 ほか `details: error.message`
- 修正案: クライアントには汎用メッセージ、詳細は logger のみ。

```diff
-        res.status(500).json({ success:false, error:'...', details: error.message });
+        logger.error('backup failed', { err: error.message });
+        res.status(500).json({ success:false, error:'バックアップの作成に失敗しました' });
```

- 横展開: `grep -n "error.message" server.js` の応答返却箇所を一括見直し。

## S8 [Medium] SQL パラメータ化の網羅確認(インジェクション)
- 該当: pg 使用箇所全般。多くは `$1` プレースホルダ使用と見られるが、文字列連結クエリが混在しないか要確認。
- 確認コマンド: `grep -nE "query\(\s*[\`'\"].*\$\{" api/server.js`(テンプレートリテラルで変数を埋めた query を検出)。ヒットがあれば個別に $ プレースホルダ化。
- restore(S1)以外に動的連結があれば個別修正。

## S9 [Medium] 認証キャッシュ TTL と検証
- 該当: api/server.js:132-135(graphTokenCache に 60 秒 TTL)
- 所見: Graph /me による検証は妥当。ただしトークン署名の事前検証はなく Graph 到達性に依存。POC では許容だが、本番は JWKS でのローカル検証を検討。

## S10 [Low] winston ファイルログのエフェメラル性
- 該当: logger 設定(File transport)。Container Apps FS は揮発性。
- 修正案: 本番は Console transport 主体にし、プラットフォームログ(Log Analytics)へ集約。

## S11 [Low] express.json の 10mb 上限
- 該当: api/server.js:154 `express.json({ limit: '10mb' })`
- 所見: restore を廃止すれば通常 API には過大。廃止後に 1mb 程度へ縮小し DoS 面を縮小。

---

## 推奨適用順序(Phase 0 内)

1. S1・S2・S5・S6: 危険エンドポイントをフラグ+requireAdmin で即封鎖(影響大・変更小)。
2. S3: 更新系に requireAuth を段階導入。
3. S4: CORS allowlist 化。
4. S7・S8: エラー返却の是正、動的クエリの確認。
5. S10・S11: ログ/上限の調整。

各適用後に `docker compose up -d --build api` とスモークテスト(Phase 1 で作成)で回帰確認。M365 を required にする最終判断は脅威モデル §9 の確認待ち。
