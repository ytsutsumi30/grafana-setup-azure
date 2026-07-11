# OSS Grafana 埋め込み表示 全体計画

この文書は、OSS 版 Grafana を Azure Container Apps + Supabase または GCP Cloud Run + Supabase 上で実行し、そのダッシュボード・パネルを出荷検品アプリ(および在庫・受発注拡張)の HTML 画面に iframe で埋め込み表示するための計画書です。

関連文書:

- docs/manufacturing-inventory-plan.md (入庫・在庫・棚卸し計画。Grafana Cloud 監視を含む)
- docs/manufacturing-order-plan.md (受発注・製造指図計画)
- G:\マイドライブ\AI-Memory\projects\Grafana (OSS Grafana 検証資産。ダッシュボード JSON、REST API 投入スクリプト、Cloud Run デプロイスクリプト)

## 目的

現場端末(ハンディ、タブレット、現場モニター)で動く検品アプリの画面内に、ログイン操作なしでリアルタイム更新される Grafana グラフを表示します。

```text
アプリ HTML 画面
  -> iframe
  -> OSS Grafana (ACA または Cloud Run)
  -> Supabase PostgreSQL (Grafana 設定 DB + 業務データソース)
```

## 前提の整理: Grafana Cloud と OSS の違い

| 項目 | Grafana Cloud | OSS セルフホスト |
|------|---------------|------------------|
| Public/Shared Dashboards (共有 URL) | 可 | 可 |
| iframe 埋め込み (allow_embedding) | 不可 (設定変更不可) | 可 |
| 匿名アクセス (anonymous auth) | 不可 | 可 |
| パネル単体埋め込み (d-solo) | 不可 | 可 |

Grafana Cloud の Public Dashboards は「別タブで開く共有 URL」としては使えますが、`allow_embedding` を変更できないため HTML への iframe 埋め込みはブロックされます。パネル埋め込みと匿名アクセスは OSS / Enterprise のみの機能です。

したがって、アプリ画面への埋め込み表示を行う場合は OSS 版セルフホストを採用します。Grafana Cloud は在庫計画(manufacturing-inventory-plan.md)の運用監視・アラート用途として併用し、役割を分けます。

```text
Grafana Cloud    : 運用監視・アラート (管理者向け、Grafana にログインして見る)
OSS Grafana      : 現場向け埋め込みグラフ (アプリ画面内、ログイン不要)
```

## 基本方針

- OSS Grafana をアプリと同じ実行基盤 (ACA または Cloud Run) にコンテナとして追加する。
- Grafana の設定 DB (ダッシュボード定義、データソース定義) は SQLite ではなく Supabase PostgreSQL に外出しし、コンテナをステートレスにする。
- 業務データの可視化は、Supabase 上のアプリ DB (shipping_inspections、qr_inspections、inventory_transactions 等) を PostgreSQL データソースとして直接参照する。
- Grafana は外部に直接公開せず、既存の web (nginx) コンテナから `/grafana/` パスでリバースプロキシする (同一オリジン構成)。
- 埋め込みは匿名 Viewer アクセス + `d-solo` (パネル単体) またはキオスクモード (ダッシュボード全体) を使う。
- ダッシュボード定義は既存資産 (Grafana プロジェクトの dashboards/*.json と REST API 投入スクリプト) を流用し、コードとして管理する。

## 全体アーキテクチャ

### Azure Container Apps 構成 (主案)

```text
Browser / iPhone / iPad
  -> web (nginx, 外部 ingress)
       /            -> 静的 HTML/JS/CSS
       /api/*       -> api コンテナ (internal ingress)
       /grafana/*   -> grafana コンテナ (internal ingress)  <- 追加
  -> api -> Supabase (アプリ DB)
  -> grafana -> Supabase (Grafana 設定 DB + アプリ DB データソース)
```

- grafana は Container Apps の internal ingress とし、外部から直接アクセスできない。
- アプリ側の認証 (M365 委任認証) や IP 制限がそのまま Grafana 閲覧にも効く。
- 同一オリジンのため Cookie / CORS / X-Frame-Options の問題が発生しない。

### GCP Cloud Run 構成 (併記)

```text
Browser
  -> web (nginx, Cloud Run 公開サービス)
       /grafana/*   -> grafana (Cloud Run 内部サービス)
  -> grafana -> Supabase
```

- grafana サービスは ingress を internal または internal-and-cloud-load-balancing とし、web からのみ到達させる。
- nginx から Cloud Run 内部サービスへは、サービス間認証 (IDトークン) を付与するか、同一 VPC 経由 (Direct VPC egress / Serverless VPC Access) で接続する。
- min-instances は 1 を推奨する。0 だとコールドスタートで初回のグラフ表示が遅く、現場モニター用途に向かない。
- Grafana プロジェクトの scripts/deploy-cloud-run.ps1 (ダッシュボードビルダー UI の展開実績) をデプロイ手順の参考にする。

### ACA と Cloud Run の比較

| 観点 | Azure Container Apps | Cloud Run |
|------|----------------------|-----------|
| 既存アプリとの同居 | 済み (web/api が稼働中) | 新規展開が必要 |
| 内部サービス間通信 | internal ingress で完結 | ingress 制限 + 認証/VPC 設定が必要 |
| スケールゼロ | 可 (min replicas 1 推奨) | 可 (min-instances 1 推奨) |
| 推奨 | 主案。既存 Terraform に追加 | アプリを GCP 展開する場合の代替 |

## Grafana コンテナ設定

### 必須環境変数

```text
# 埋め込み許可
GF_SECURITY_ALLOW_EMBEDDING=true

# 匿名閲覧 (Viewer)
GF_AUTH_ANONYMOUS_ENABLED=true
GF_AUTH_ANONYMOUS_ORG_NAME=Main Org.
GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer

# サブパス配信 (nginx /grafana/ プロキシ用)
GF_SERVER_ROOT_URL=https://<app-domain>/grafana/
GF_SERVER_SERVE_FROM_SUB_PATH=true

# 設定 DB を Supabase に外出し (ステートレス化)
GF_DATABASE_TYPE=postgres
GF_DATABASE_HOST=<supabase-pooler-host>:5432
GF_DATABASE_NAME=grafana
GF_DATABASE_USER=<user>
GF_DATABASE_PASSWORD=<secret>
GF_DATABASE_SSL_MODE=require

# 管理者 (secret 管理)
GF_SECURITY_ADMIN_USER=<secret>
GF_SECURITY_ADMIN_PASSWORD=<secret>
```

補足:

- 設定 DB を外出ししない場合、ACA / Cloud Run のファイルシステムは揮発性のため、再起動でダッシュボード定義が消える。
- Grafana 設定 DB はアプリ DB と分離するため、Supabase 上に `grafana` スキーマまたは別データベースを用意する。
- 認証情報は Container Apps secrets / Secret Manager で渡し、イメージや Git に含めない。

### nginx 設定追加

```nginx
location /grafana/ {
    proxy_pass http://grafana:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Grafana Live (WebSocket) を使う場合
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

ACA では `proxy_pass` 先を grafana コンテナアプリの internal FQDN に、Cloud Run では内部サービス URL に置き換えます。

## データソース設計

TestData ではなく、Supabase 上のアプリ DB を PostgreSQL データソースとして登録します。

```text
datasource: Supabase (PostgreSQL)
  - 接続: Session Pooler、SSL 必須
  - ユーザー: 読み取り専用ロール (SELECT のみ) を新設する
  - 参照テーブル例:
      shipping_inspections   検品実績
      qr_inspections         QR 検品
      inventory_transactions 在庫変動 (在庫計画)
      operation_events       業務イベント (在庫計画)
      metrics_timeseries     既存モニタリングテーブル
```

Grafana 用 DB ユーザーは読み取り専用とし、アプリのテーブルを UPDATE できないようにします。

## 埋め込み方法

### パネル単体 (d-solo)

ダッシュボードの特定パネルだけを埋め込む場合:

```html
<iframe
  src="/grafana/d-solo/<dashboard-uid>/<slug>?orgId=1&panelId=2&from=now-6h&to=now&refresh=30s&theme=light"
  width="100%" height="300" frameborder="0"></iframe>
```

### ダッシュボード全体 (キオスクモード)

現場モニターにダッシュボード全体を表示する場合:

```html
<iframe
  src="/grafana/d/<dashboard-uid>/<slug>?kiosk&refresh=30s&theme=light"
  width="100%" height="800" frameborder="0"></iframe>
```

### 主な URL パラメータ

```text
panelId    埋め込むパネル ID (d-solo 時)
from / to  表示期間 (now-6h, now など)
refresh    自動更新間隔 (5s, 30s, 1m)
theme      light / dark (アプリ画面に合わせる)
kiosk      メニュー・ヘッダーを隠す
var-xxx    テンプレート変数 (例: var-location=LOC-01)
```

テンプレート変数を使うと、アプリ側で選択中の保管場所や品目を iframe URL に引き渡して絞り込み表示できます。

## 画面設計案

### 埋め込み対象画面

- monitoring.html: 既存の Chart.js ベース表示を Grafana パネルへ段階的に置換
- ダッシュボード (index): 本日の検品件数、出荷進捗のパネルを埋め込み
- 在庫画面 (在庫計画): 在庫推移、棚卸差異のパネルを埋め込み
- 現場モニター用ページ (新規): キオスクモードの全画面ダッシュボード

### 埋め込み用ダッシュボード案

```text
shipping-floor-dashboard    出荷検品現場向け (本日の指示・検品進捗・エラー)
inventory-dashboard         在庫状況 (ステータス別在庫・入庫予定・期限間近ロット)
count-dashboard             棚卸進捗 (スキャン進捗・差異件数)
production-dashboard        製造進捗 (指図別工程進捗・遅延) ※受発注計画 Phase 5 以降
```

既存資産 (Grafana プロジェクト) の press-maintenance / power-monitoring ダッシュボード JSON とREST API 投入スクリプトの形式を流用し、`dashboards/*.json` + 投入スクリプトとしてリポジトリ管理します。

## セキュリティ設計

- 匿名アクセスは Viewer 固定とし、編集・保存・Explore は不可とする。
- 匿名で閲覧できる範囲は Org 単位となるため、埋め込み用ダッシュボードだけを置く Org (または専用フォルダ + 権限設定) に分離する。
- Grafana は internal ingress とし、外部からの直接アクセス経路を作らない。閲覧は必ずアプリの nginx 経由とする。
- アプリ側で M365 認証を必須にすれば、Grafana グラフも認証済みユーザーにしか表示されない。
- Grafana 用 DB ユーザーは読み取り専用とする。
- admin パスワード、DB 接続情報は secrets 管理とし、既定値 (admin/admin) を本番に持ち込まない。
- /grafana/ 配下に対するレート制限を nginx で設定する (現場端末台数に応じて調整)。

## 実装フェーズ

### Phase 1: ローカル検証 (Docker Compose)

- 既存 docker-compose.yml に grafana サービスを追加
- GF_SECURITY_ALLOW_EMBEDDING / 匿名アクセス / サブパス設定
- nginx に /grafana/ プロキシ追加
- ローカル PostgreSQL をデータソース登録し、検品実績パネルを作成
- monitoring.html に iframe を仮組みし、表示・自動更新を確認

### Phase 2: ダッシュボード整備

- 埋め込み用ダッシュボード (shipping-floor / inventory) を JSON + 投入スクリプトで作成
- テンプレート変数 (保管場所、品目) の設計
- theme=light / dark のアプリ画面との調和確認

### Phase 3: Supabase 対応

- Supabase に Grafana 設定 DB (grafana スキーマ/DB) を作成
- 読み取り専用 DB ユーザーを作成し、データソースを Supabase に切替
- ステートレス動作 (コンテナ再作成でダッシュボードが残ること) を確認

### Phase 4: Azure Container Apps 展開

- Terraform (infra/terraform) に grafana コンテナアプリを追加 (internal ingress)
- secrets 設定 (DB 接続、admin)
- web の nginx テンプレートに /grafana/ プロキシ追加
- 本番 URL での埋め込み表示・M365 認証併用を確認

### Phase 5: Cloud Run 展開 (GCP を採用する場合のみ)

- grafana / web サービスのデプロイ (scripts/deploy-cloud-run.ps1 を参考)
- ingress 制限とサービス間認証 (または VPC 経由) の設定
- min-instances=1 とコールドスタート影響の確認

### Phase 6: 運用整備

- ダッシュボード JSON の CI 投入 (REST API スクリプト)
- Grafana 自体の稼働監視 (Grafana Cloud またはヘルスチェック) 
- 現場モニター用キオスクページの常時表示運用ルール

## POC 完成条件

```text
OSS Grafana が ACA (または Cloud Run) 上でステートレスに稼働する。
Grafana 設定 DB が Supabase にあり、再デプロイ後もダッシュボードが保持される。
Supabase のアプリ DB を読み取り専用データソースとして参照できる。
アプリの HTML 画面に d-solo パネルが iframe 表示される。
現場端末でログイン操作なしにグラフが閲覧できる。
refresh パラメータによる自動更新が動作する。
Grafana へ外部から直接アクセスできないことが確認できる。
匿名ユーザーが編集・保存・Explore できないことが確認できる。
```

## 後回しにする項目

- Grafana Enterprise 機能 (データソース権限の細分化、白ラベル化)
- JWT / プロキシ認証によるユーザー単位の埋め込み認可
- Grafana Live による秒間隔ストリーミング表示
- 画像レンダラー (grafana-image-renderer) による PNG 埋め込み・帳票貼付
- アラートの OSS Grafana 側への移管 (当面 Grafana Cloud 側で運用)
- 複数拠点・複数 Org 展開
