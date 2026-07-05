# 脅威モデル: 出荷検品アプリ (grafana-setup-azure)

作成: 2026-07-06 / ブランチ: chore/debt-p0-security / スキル: security-threat-model
対象: リポジトリ全体(runtime = web/nginx + api/Node.js + Supabase PostgreSQL)。CI/dev ツールとテストは対象外。

本文書は汎用チェックリストではなく、本リポジトリのコードに紐づく脅威モデルです。各主張はファイル:行の根拠を伴います。

## 1. システムモデル(スコープ)

| コンポーネント | 実体 | 根拠 |
|---|---|---|
| web | nginx。静的 HTML 配信 + `/api` を API へリバースプロキシ。外部公開 | web/default.conf.template, docker-compose.yml |
| api | Node.js/Express。約 130 エンドポイント単一ファイル | api/server.js(5,691 行) |
| DB | Supabase PostgreSQL(Session Pooler)。本番。ローカルは postgres コンテナ | docker-compose.yml, api/server.js pool |
| 認証 | M365 委任認証(MSAL + Graph)。**オプション**。既定で無効 | api/server.js:55-58(enabled/required フラグ) |

実行形態: 外部から web(HTTPS)→ 内部で api(内部 ingress)。API は Azure Container Apps の internal ingress 想定。

## 2. 信頼境界

| 境界 | エッジ | 認証 | 検証 | レート制限 | 備考 |
|---|---|---|---|---|---|
| B1 | インターネット → web(nginx) | なし | - | nginx 層次第 | 公開面 |
| B2 | web → api(/api/*) | **なし(既定)** | 部分的 | あり(15分/100) | M365_AUTH_REQUIRED=true で有効化可 |
| B3 | api → Supabase | DB 資格情報 | pg パラメータ化(要確認) | - | 資格情報は env |
| B4 | api → OS(exec / fs) | - | 一部のみ | - | backup/logs で shell・ファイル操作 |
| B5 | api → Microsoft Graph | Bearer トークン | Graph 検証 | - | 認証有効時のみ |

## 3. 資産

- 業務データ(出荷指示・検品実績・在庫・取引先)。PII を含みうる(配送先・担当者)。
- DB 資格情報(DB_PASSWORD)、Supabase アクセストークン、M365 テナント/クライアント ID。
- 可用性クリティカルなコンポーネント: api(単一プロセス)、DB。
- 完全性クリティカルな状態: 在庫・検品結果(改ざんは業務影響大)。
- 監査ログ(combined.log / error.log)。

## 4. 攻撃者能力と非能力

- 能力: 公開 web URL を知る任意のインターネット利用者。/api 配下へ直接 HTTP リクエスト可能(B2 に認証がないため)。
- 能力: 正規ネットワーク内の第三者(現場端末の盗難・共有端末)。
- 非能力: 本リポジトリでは Supabase の管理コンソール、Azure コントロールプレーン、コンテナホストへの権限は想定しない。DB 資格情報や tfstate はディスク上に存在するが git には未追跡(§7 参照)。

## 5. エントリポイントと脅威(悪用パス)

### T1 [Critical] 認証なしの任意 SQL 実行 — /database/restore
- 根拠: api/server.js:5072。`req.body.sql` を受け取り `client.query(sql)` で実行。認証ミドルウェアの適用なし(グローバル `app.use` に auth なし)。
- 悪用: 攻撃者が `POST /api/database/restore {"sql":"DROP TABLE ...; SELECT ..."}` を送信 → 全データの読み取り・破壊・改ざん。
- 影響: 高(完全性・機密性・可用性すべて) / 尤度: 高(前提条件なし、公開面) → **優先度 Critical**。

### T2 [Critical] 認証なしのバックアップ実行 + コマンド構築 — /database/backup
- 根拠: api/server.js:4919 & 3293。`exec("PGPASSWORD=... pg_dump ... > ${backupPath}")` を文字列連結で構築。認証なし。
- 悪用: 認証なしで DB 全体を dump 可能。backupPath/env が将来ユーザー入力に接続されると OS コマンドインジェクションに発展。現時点でも DB 全件ダンプは機密性侵害。
- 影響: 高(機密性) / 尤度: 高 → **優先度 Critical**。

### T3 [Critical] 認証境界の不在(B2 全体)
- 根拠: api/server.js:152-153 は helmet/cors のみ。認証を強制する `app.use` が存在しない。M365 は required フラグ次第で、docker-compose では `M365_AUTH_REQUIRED=false`。
- 悪用: すべての参照・更新・削除エンドポイント(products, shipping-instructions, inventory, inspectors 等)が無認証。データ改ざん・なりすまし登録。
- 影響: 高 / 尤度: 高 → **優先度 Critical**。

### T4 [High] CORS 全開
- 根拠: api/server.js:153 `app.use(cors())`(オリジン無制限)。
- 悪用: 任意オリジンの Web ページから資格情報なしのクロスオリジン要求。無認証と相まってブラウザ経由の悪用を容易化。
- 影響: 中〜高 / 尤度: 中 → **優先度 High**。

### T5 [High] ログ内容の取得 — /logs/content/:filename, /logs/files
- 根拠: api/server.js:3399。filename は allowlist(error.log/combined.log)で path traversal は緩和済みだが、認証がないためログ本文(IP・リクエスト・エラー詳細)が外部から閲覧可能。
- 悪用: 運用情報・内部パス・エラースタックの漏洩。偵察に利用。
- 影響: 中 / 尤度: 高 → **優先度 High**。

### T6 [Medium] サンプルデータ生成の無認証実行
- 根拠: /qc-tools/generate-sample-data, /monitoring/generate-sample-data(認証なし)。
- 悪用: 本番 DB へのデータ汚染、行数肥大による DoS。
- 影響: 中 / 尤度: 中 → **優先度 Medium**。

### T7 [Medium] エラー詳細の応答返却
- 根拠: 例: api/server.js:3312 で `details: error.message` を応答に含める。
- 悪用: 内部実装・SQL・パスの露出。
- 影響: 低〜中 / 尤度: 高 → **優先度 Medium**。

### T8 [Low] winston ファイルログのエフェメラル性
- 根拠: /app に error.log/combined.log 書き込み。Container Apps の FS は揮発性。
- 影響: 監査証跡の喪失(セキュリティ検知の低下)。可用性・機密性への直接影響は小 → **優先度 Low**。

## 6. 既存の緩和策(根拠あり)

- helmet 既定ヘッダ(api/server.js:152)。
- express-rate-limit 15分/100(api/server.js:158)、trust proxy 設定あり。
- /logs/content の filename allowlist(api/server.js:3390 付近)。
- restore の入力サイズ上限 10MB、restore はトランザクション。
- M365 検証は Graph /me + allowedDomains チェック(api/server.js:103-126)。ただし既定無効。

## 7. 秘密情報の状態(D7 実測)

- git 追跡: `git ls-files` に tfstate/tfvars/supabase-project.json/.env は**なし**(.gitignore が既にカバー: `*.tfstate*`, `*.tfvars`(!example), `supabase-project.json`, `.env*`, `secrets/`)。→ Git 経由の漏洩リスクは低い。
- ディスク上: infra/terraform/terraform.tfstate(+backup)、terraform.tfvars、supabase-project.json が作業ツリーに存在。tfstate は DB 接続文字列等の機微情報を平文で含みうる。
- create-supabase-project.sh は環境変数参照のみでハードコード秘密なし(良好)。
- 残リスク: (a) 作業ツリー/バックアップ経由のローカル漏洩、(b) tfstate をローカル保持している運用。→ Azure Storage リモートバックエンド化を推奨(docs/security/state-backend.md)。

## 8. 推奨緩和(優先度順)

| 対応 | 対象 | 種別 |
|---|---|---|
| M1 | /database/restore・/database/backup・/logs/*・/*/generate-sample-data を無効化 or 管理者認証必須化。POC では env フラグで既定オフに | authZ / 攻撃面削減 |
| M2 | 認証ミドルウェアを全 /api に強制(M365_AUTH_REQUIRED=true を本番既定に)。最低限、更新系(POST/PUT/PATCH/DELETE)と管理系に必須化 | authZ |
| M3 | CORS をアプリドメインの allowlist に限定(`cors({ origin: [...] })`) | 設定 |
| M4 | restore の任意 SQL 実行を廃止し、スキーマ適用は CI/スクリプト経由に限定 | 設計 |
| M5 | エラー応答から details/stack を除去し、内部ログのみに記録 | 情報漏洩 |
| M6 | tfstate を Azure Storage バックエンドへ移行、ローカル tfstate を削除 | 秘密管理 |
| M7 | backup を exec 文字列連結でなく引数配列(execFile)化、または pg クライアント経由に | インジェクション耐性 |

## 9. 前提と未解決の質問

- 前提: 本番 Container Apps の api は internal ingress で、web 経由のみ到達。**もし api が external ingress なら T1-T3 の尤度はさらに上昇**。→ 要確認。
- 前提: 現在の公開 URL は限定共有(POC)。一般公開の度合いにより優先度が変わる。
- 質問: (1) api ingress は internal か external か。(2) M365 認証を本番で必須化する意思決定はあるか。(3) /database/* と /logs/* は運用で実際に使われているか(廃止可否)。

これらの回答で M1/M2 の実装方針(完全無効化 vs 認証化)を確定します。
