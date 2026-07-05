# 技術的負債 改善計画

この文書は、docs/ui-improvement-plan.md で洗い出した技術的負債を中心に、コードベース全体の負債を棚卸しし、Agent Skills の適用と合わせて解消するための計画書です。実行手順は docs/tech-debt-execution-plan.md を参照。

## 目的

負債を「機能追加の前に潰すもの」と「機能追加と並行で潰すもの」に分類し、今後の 4 計画(在庫・受発注・Grafana・UI)の実装コストとリスクを下げます。

## 負債の棚卸し

| # | 負債 | 影響 | 重大度 |
|---|------|------|--------|
| D1 | 実験・バックアップ HTML の混在(47 本中、本番約 15 本) | 本番ページが判別不能。誤修正・誤参照のリスク | 高 |
| D2 | 全ページのインライン style 個別実装、ステータス色の不統一 | デザイン修正が全ページに波及しない。画面追加のたびに流儀が発散 | 高 |
| D3 | JS の重複系統: web/js/modules と web/modules に同名ファイル、app.js / index-app.js / app-backup.js の並存 | どれが参照されているか不明。修正漏れの温床 | 高 |
| D4 | 外部 CDN 依存(Bootstrap / Font Awesome / QR / Chart.js) | 工場内ネットワークで CDN 遮断時に全画面崩壊 | 高 |
| D5 | server.js の肥大化(単一ファイルに約 130 エンドポイント、5,691 行)+ server.js.backup 混在 | 受発注・在庫の API 追加で更に悪化。レビュー・テスト困難 | 高 |
| D6 | セキュリティ指摘の未解決(認証なし公開、/database/backup・restore 無防備、CORS 全開) | assessment.md 指摘のまま公開運用中 | 最重要 |
| D7 | terraform.tfvars / tfstate / supabase-project.json がリポジトリ・同期フォルダ内に存在 | 秘密情報の同期・漏洩リスク | 最重要 |
| D8 | PWA 未完成(manifest はあるが Service Worker なし)、manifest・タイトルが実態と不一致 | オフライン耐性なし。「モックアップ」表記のまま | 中 |
| D9 | 自動テスト不在(unit / E2E とも) | ページ整理・リファクタのリグレッション検出手段がない | 高 |
| D10 | 移行遺物: qr-inspection.bak、*.backup-*、index.html.backup 等 | ノイズ。イメージサイズ・検索性の悪化 | 低 |

## 基本方針

- 着手順は「安全(D6/D7)→ 判別可能(D1/D3/D10)→ 共通化(D2/D4)→ 分割(D5)→ 検証(D9)→ 完成(D8)」。
- 破壊的な整理(D1/D3)の前に、現行動作のスモークテストを最低限用意する(D9 の先行分)。
- 共通化(D2)は自作スキル prj3-frontend を先に作成し、以後の画面改修・新規作成をスキル経由で統一する。
- 各 Phase は独立してデプロイ可能な単位に保つ。

## 改善フェーズとスキル適用

### Phase 0: セキュリティと秘密情報(D6 / D7)— 最優先

- terraform.tfvars / terraform.tfstate / supabase-project.json を git 管理から外し、state は Azure Storage バックエンドへ移行を検討
- /database/backup・/database/restore・/logs 系エンドポイントを無効化または認証必須化
- CORS をアプリドメインに限定
- M365 認証(既存 m365-auth.js / API 側フラグ)の必須化を判断

適用スキル: security-best-practices、security-threat-model

### Phase 1: ページと JS の整理(D1 / D3 / D10)

- 本番ページ確定(qr-inspection 系・ocr 系の採用版決定)→ web/_archive/ へ退避
- 未参照の app-backup.js・重複 modules を _archive へ
- *.bak・*.backup-* を削除または _archive へ
- nginx で _archive を遮断、.dockerignore に追加
- タイトル・manifest.json を実態に合わせ修正(D8 の一部)

適用スキル: web-design-reviewer、playwright(整理前スモークテスト)

### Phase 2: 共通基盤と CDN ローカル化(D2 / D4)

- css/tokens.css・css/components.css・js/layout.js を導入
- 全本番ページをトークン・共通ナビ参照へ書き換え
- ライブラリを web/vendor/ へ配置し CDN 参照を置換

適用スキル: prj3-frontend(自作)、frontend-design、theme-factory

### Phase 3: server.js のルート分割(D5)

- 機能ドメイン単位でルートを分割(products / shipping-instructions / qr-inspections / inspectors / reports / qc-tools / new-qc / monitoring / inventory / pps / system)
- DB プール・logger・バリデーションを lib / middleware へ抽出
- server.js は起動とルート登録のみ(目標: 200 行以下)

適用スキル: refactor、playwright(分割前後のスモーク)

### Phase 4: テスト整備(D9)

- E2E: 検品フロー・ピッキング・マスタ CRUD
- API: 分割後ルートのコントラクトテスト

適用スキル: playwright、webapp-testing

### Phase 5: PWA 完成(D8)

- Service Worker + IndexedDB スキャンキューと再送
- 現場モード start_url での iOS Safari 起動確認

適用スキル: prj3-frontend(自作)

## 完成条件

```text
D6/D7: 秘密情報が git 管理外へ退避され、危険なエンドポイントが保護されている。
D1/D3/D10: web 配下が本番ページのみになり、_archive が遮断されている。
D2: 全本番ページが tokens.css / components.css / layout.js を参照している。
D4: 外部 CDN なしで全画面が表示される。
D5: server.js が起動+ルート登録のみになり、ルートがドメイン別ファイルに分割されている。
D9: 検品フローの E2E と API スモークテストが実行できる。
D8: PWA がオフラインでスキャンを継続でき、復帰後に再送される。
prj3-frontend スキルで新規画面が共通規約で生成される。
```

## 後回しにする項目

- CI/CD パイプラインへのテスト組み込み(リポジトリ運用方針の確定後)
- SPA フレームワークへの移行
- API の TypeScript 化
- WCAG 準拠監査
