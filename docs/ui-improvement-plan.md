# 出荷検品アプリ デザイン・UI・機能改善 全体計画

この文書は、既存の出荷検品アプリ(web 配下の静的 HTML/CSS/JS)のデザイン統一、UI/UX 改善、機能改善、および技術的負債の解消を行うための計画書です。

関連文書:

- docs/manufacturing-inventory-plan.md (入庫・在庫・棚卸し計画)
- docs/manufacturing-order-plan.md (受発注・製造指図計画)
- docs/grafana-embedding-plan.md (OSS Grafana 埋め込み計画)
- assessment.md (移行時の評価。CDN 依存等の指摘を含む)

## 目的

現場端末(タブレット、ハンディ、iPhone)での操作性と信頼性を高め、今後の機能拡張(在庫・受発注・Grafana 埋め込み)を低コストで載せられる UI 基盤を整えます。

## 現状の課題

### 技術的負債

- web 配下に 47 の HTML があり、実運用ページは 15 前後。safari*.html (6 種)、qr-inspection 系 (7 種)、index-org / index-original、*.backup-* などの実験・バックアップページが混在し、本番ページが判別できない。
- 全ページがヘッダー・ナビ・スタイルを個別のインライン style で実装しており、デザイン修正が全ページに波及しない。
- index.html のタイトルが「出荷検品システム - モックアップ」のまま。manifest.json の名称も「在庫照合」で実態と不一致。
- Bootstrap / Font Awesome / QR ライブラリを外部 CDN から取得しており、工場内ネットワークで CDN が遮断されると全画面が崩れる。
- manifest.json はあるが Service Worker がなく、PWA として未完成。オフライン耐性がない。

### UI/UX

- ページ間遷移が「戻るボタン」の連鎖で、階層が深い画面から迷子になる。
- ステータス色 (pending / approved / rejected 等) が画面ごとに微妙に異なる。
- スキャン結果のフィードバックが画面表示のみで、連続スキャン時に画面を注視する必要がある。
- 手袋着用時にはボタンが小さい画面がある。
- 検品者選択を都度行う必要がある。
- 検品待ち一覧に絞り込み・ソートがない。

## 基本方針

- 先にページ整理と共通レイアウトを導入し、以降の改善を全画面へ一括適用できる状態を作る。
- 現場モード (タブレット/ハンディ、大ボタン、最小限の情報) と管理モード (PC、サイドバー付き) を分離する。
- デザインは CSS 変数によるデザイントークンで統一する。
- 外部 CDN 依存を排除し、アセットをローカルバンドルする。
- PWA (Service Worker + IndexedDB) でオフライン耐性を持たせる。
- モニタリング表示は Grafana 埋め込み計画へ統合し、Chart.js 実装との二重管理を解消する。

## ページ整理計画

### 本番ページ (残す)

```text
index.html                        検品待ち一覧 (ダッシュボード)
qr-inspection3.html               QR 検品 (本番系を確定して rename)
pps.html                          PPS フロー (ピッキング/梱包)
ItemPicking.html                  ピッキング
maintenance.html                  メンテナンスハブ
products.html                     製品マスタ
shipping-locations.html           出荷元拠点
delivery-locations.html           配送先拠点
product-components.html           製品構成部品
inspectors.html                   検品者マスタ
shipping-instructions.html        出荷指示
shipping-instruction-maintenance.html
production-plans.html             生産計画
inventory.html                    在庫
monitoring.html                   モニタリング (Grafana 埋め込みへ移行)
qc-dashboard.html / qc-analysis.html
ocr.html (本番系を確定)
database.html / logs.html / system-config.html
```

### アーカイブ (web/_archive/ へ退避)

```text
safari.html safari2.html safari3.html safari31.html safari4.html
qr-inspection.html qr-inspection2.html qr-inspection-v2.1.html
qr-inspection-backup-*.html qr-ins.html qr-ins-android.html
index-org.html index-original.html
shipping-inspection-mockup.html shipping-instruction-mockup2.html
camera-test.html QRPOC.html qr.html android.html
aws-system-diagram.html exhibition-flyer.html
*.backup-* *.bak
ocr-enhanced-demo.html ocr-enhanced.html ocr-v2-enhanced.html (本番系確定後)
```

nginx で `_archive/` へのアクセスを遮断し、Docker イメージから除外します。

## デザイン統一設計

### デザイントークン (css/tokens.css)

```css
:root {
  /* ブランド */
  --color-primary: #0d6efd;
  --color-primary-dark: #0a58ca;

  /* ステータス (全画面共通) */
  --color-status-pending: #ffc107;
  --color-status-ok: #198754;
  --color-status-ng: #dc3545;
  --color-status-hold: #6c757d;
  --color-status-progress: #0dcaf0;

  /* タイポグラフィ */
  --font-family-base: 'Segoe UI', 'Hiragino Sans', 'Meiryo', sans-serif;
  --font-size-base: 1rem;
  --font-size-lg: 1.25rem;

  /* 現場向けサイズ */
  --touch-target-min: 48px;
  --touch-target-field: 64px;

  /* レイアウト */
  --radius-card: 0.75rem;
  --shadow-card: 0 0.5rem 1rem rgba(0, 0, 0, 0.1);
}

[data-theme="dark"] {
  /* ダークテーマ用の上書き */
}
```

### 共通コンポーネント (css/components.css)

- ページヘッダー (グラデーション、タイトル、アクション)
- ステータスバッジ (トークン参照に統一)
- カード、リスト項目 (border-left ステータス表示)
- sticky アクションバー (画面下部固定ボタン)
- トースト通知

### 共通ナビ (js/layout.js)

各ページ先頭で読み込み、ヘッダー・ナビ・フッターを挿入します。ページ側は `data-page` 属性でアクティブ表示を指定します。

```html
<script src="js/layout.js" data-page="inspection"></script>
```

### CDN のローカル化

Bootstrap、Font Awesome (使用アイコンのサブセット)、QR スキャナー、Chart.js を `web/vendor/` に配置し、CDN 参照を置換します。Docker イメージに同梱するため、外部ネットワーク遮断時も表示が崩れません。

## ナビゲーション再設計

### モード分離

```text
/ (index)
  -> 現場モード (floor.html)
       検品開始 / ピッキング / 棚卸 (在庫計画) の大ボタンランチャー
       1 画面 1 タスク、ナビ最小限
  -> 管理モード (admin: 既存 index 相当)
       サイドバー: 出荷指示 / 検品実績 / マスタ / QC / モニタリング / 設定
```

- 現場モードは PWA の start_url とし、ホーム画面追加からフルスクリーン起動する。
- 全画面にホームボタンを常時表示し、「戻る」連鎖への依存をなくす。
- モード選択は端末ごとに localStorage へ記憶する (既存 device-mode.js を拡張)。

## 現場向け UI/UX 改善

### スキャンフィードバック

- 成功: 緑フラッシュ + 短いビープ + バイブ 1 回 (Vibration API)
- 失敗/対象外: 赤フラッシュ + 低いビープ 2 回 + バイブ 2 回
- 重複スキャン: 黄フラッシュ + 通知音なし
- 画面を注視せずに連続スキャンできることを目標とする。

### 操作性

- 主要ボタンは 48px 以上、検品操作系 (OK/NG/完了) は 64px 以上とする。
- 完了・NG ボタンは画面下部の sticky アクションバーに固定し、親指圏に置く。
- 進捗を大きく常時表示する (例: 「3/12 スキャン済み」+ プログレスバー)。
- 直前スキャンの取り消し (Undo) ボタンを設ける。
- 検品者はセッション記憶とし、都度選択を不要にする (M365 認証有効時は自動設定)。

### オフライン耐性 (PWA 完成)

```text
Service Worker
  - アプリシェル (HTML/CSS/JS/vendor) をキャッシュ
  - API GET は network-first、失敗時に最終取得値を表示 (取得時刻を明示)

IndexedDB
  - スキャン結果・検品結果をローカルキューへ保存
  - オンライン復帰時にバックグラウンドで再送
  - 送信済み/未送信をアイコンで表示

UI
  - オフラインバナーを表示し、操作は継続可能にする
```

manifest.json は名称・start_url を実態に合わせて更新します。

## 機能改善

- 検品待ち一覧: 納期・配送先・優先度での絞り込みとソート、検索ボックスを追加する。
- 高優先度指示の到着通知: ポーリング (将来 SSE) でトースト表示する。
- 監査表示: 一覧・詳細に検品者と検品日時を表示する (既存 inspectors 連携)。
- エラーリカバリ: 誤スキャン Undo、検品やり直し (差し戻し) の操作を追加する。
- monitoring.html: Grafana 埋め込み (grafana-embedding-plan.md) へ段階的に置換する。

## 実装フェーズ

### Phase 1: ページ整理と共通基盤

- 本番ページの確定 (特に qr-inspection 系と ocr 系)
- _archive/ への退避、nginx 遮断、.dockerignore 追加
- tokens.css / components.css / layout.js 導入
- index.html タイトル・manifest.json 修正
- CDN のローカルバンドル化

### Phase 2: 現場向け UI 改善

- スキャンフィードバック (色 + 音 + バイブ)
- タッチターゲット拡大、sticky アクションバー統一
- 進捗常時表示、Undo
- 検品者のセッション記憶

### Phase 3: PWA / オフライン対応

- Service Worker (アプリシェルキャッシュ)
- IndexedDB スキャンキューと再送
- オフラインバナーと送信状態表示
- 現場モード start_url での PWA 起動確認 (iOS Safari 含む)

### Phase 4: ナビ再設計とダークテーマ

- 現場モード / 管理モードの分離
- サイドバーナビ (管理モード)
- data-theme="dark" 対応 (Grafana theme パラメータと連動)

### Phase 5: 機能追加

- 一覧の絞り込み・ソート・検索
- 高優先度通知トースト
- 監査表示
- monitoring.html の Grafana 埋め込み置換

## POC 完成条件

```text
web 配下の本番ページが確定し、実験ページが _archive に隔離されている。
全本番ページが共通トークン・共通ナビを使用している。
外部 CDN に依存せず全画面が表示される。
スキャン成功/失敗が色・音・バイブで判別できる。
検品操作ボタンが 64px 以上で画面下部に固定されている。
オフライン中でもスキャンを継続でき、復帰後に自動送信される。
現場モードが PWA としてホーム画面から全画面起動する。
検品待ち一覧を納期・配送先・優先度で絞り込める。
直前スキャンを取り消せる。
```

## 後回しにする項目

- SPA フレームワーク (React 等) への全面移行 (静的 HTML + 共通 JS で継続)
- 多言語対応
- アクセシビリティの WCAG 準拠監査 (タッチターゲット等の実利部分のみ先行)
- プッシュ通知 (Web Push)
- 帳票 PDF のデザイン刷新
