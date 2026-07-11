# Grafana Cloud 最小監視 設計

## 目的

出荷検品 POC の業務状態を Grafana Cloud で確認できるようにする。初期段階では Prometheus 連携やアプリ内メトリクス SDK ではなく、Grafana Cloud の Infinity datasource から既存 API を JSON として参照する。

## 監視対象

- API / DB 疎通
- 受注残数量
- 発注残数量
- 出荷待ち件数
- 入庫待ち件数
- 棚卸差異数量
- 未確認アラート件数
- 業務イベント日次件数

## 追加 API

Grafana Cloud からは次の API を参照する。

- `GET /api/monitoring/grafana-cloud/kpis`
  - KPI 一覧を配列で返す。
- `GET /api/monitoring/grafana-cloud/backlog`
  - 受注、発注、出荷指示、入庫予定の残を返す。
- `GET /api/monitoring/grafana-cloud/events-daily`
  - `operation_events` の日次集計を返す。
- `GET /api/monitoring/grafana-cloud/inventory-count-variance`
  - 棚卸差異を棚卸セッション単位で返す。

## Grafana Cloud 取り込み方針

Grafana Cloud では Infinity datasource を使う。

- datasource UID: `grafanacloud-infinity`
- datasource type: `yesoreyeram-infinity-datasource`
- API URL の `__API_BASE_URL__` を公開 URL に置換する。

公開 URL 例:

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

## ダッシュボード定義

Grafana 側リポジトリに次の JSON を配置する。

```text
C:\Users\tsuts\OneDrive\ドキュメント\Grafana\dashboards\shipping-inspection-minimal-monitoring.json
```

インポート前に `__API_BASE_URL__` を Azure Container Apps の公開 URL へ置換する。

## POC の制約

- API 監視は JSON polling であり、Prometheus メトリクスではない。
- 認証必須環境では Grafana Cloud から API を読むための認証方式が別途必要。
- 本番運用では Application Insights、Azure Monitor、Grafana Cloud Prometheus 連携を併用する。

## 次ステップ

1. Azure 公開 URL で追加 API が 200 を返すことを確認する。
2. Dashboard JSON の `__API_BASE_URL__` を公開 URL に置換する。
3. Grafana Cloud に Infinity datasource を設定する。
4. JSON をインポートする。
5. しきい値と通知ルールを業務基準に合わせる。
