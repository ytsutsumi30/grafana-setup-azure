---
name: prj3-frontend
description: 出荷検品アプリのフロントエンド実装規約。対象は ~/grafana-setup-azure(github.com/ytsutsumi30/grafana-setup-azure)の web/ 配下のみ。このリポジトリで HTML/CSS/JS の新規作成・修正、画面追加、検品・ピッキング・棚卸・在庫・受発注の現場向け画面、デザイントークン・ダークテーマ・スキャンUI・PWA/オフライン対応を扱うときは必ず使う。「画面を作って」「UIを直して」等の曖昧な依頼でも web/ 配下が対象なら適用する。他リポジトリのUI作業では使わない。
---

# prj3 フロントエンド規約(静的HTML + Vanilla JS + nginx)

目的: (1) 現場端末(手袋・屋内Wi-Fi・iOS Safari)で確実に動く、(2) 全画面が同じ流儀で書かれ共通基盤の修正が全画面に効く。

## DO(やること)

- 新規ページは共通骨格から開始。既存ページの修正も骨格に近づける方向で直す:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ページ名 - 出荷検品システム</title>
  <link rel="stylesheet" href="vendor/bootstrap/bootstrap.min.css">
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/components.css">
</head>
<body data-page="ページID">
  <script src="js/layout.js"></script>  <!-- 共通ヘッダー・ナビ -->
  <main class="container">...</main>
  <script src="js/pages/ページID.js"></script>
</body>
</html>
```

- 色・サイズは `css/tokens.css` の変数を参照(`--color-status-ok/ng/pending/progress`、`--touch-target-min: 48px`、`--touch-target-field: 64px`)。ステータスはバッジ共通クラス(`badge-ok/ng/pending`)。ダークテーマは `[data-theme="dark"]` の変数上書きのみで成立させる。
- ライブラリは `web/vendor/` に置き相対参照。ページ固有スタイルが必要な場合のみ `css/pages/ページID.css`。
- スキャン系画面: 1画面1タスク / 主要アクション(完了・NG・取消)は下部sticky・64px以上 / 進捗「3/12」を大きく常時表示 / フィードバックは3チャネル同時(画面フラッシュ 緑=成功・赤=失敗・黄=重複、ビープ 成功=短1回・失敗=低2回、`navigator.vibrate` 成功1・失敗2)/ 直前スキャンのUndo必須 / 検品者・作業者はlocalStorageでセッション記憶し毎回選択させない。
- API は同一オリジン `/api/...` を fetch。失敗は共通トースト `showToast(message, type)` で通知。スキャン系POSTは失敗時 IndexedDB キュー(`js/offline-queue.js`)へ保存し `online` イベントで再送、送信済/未送信をアイコン表示。
- モニタリングは Chart.js を新規実装せず、同一オリジン Grafana iframe を使う(`/grafana/d-solo/<uid>/<slug>?orgId=1&panelId=2&from=now-6h&to=now&refresh=30s&theme=light|dark` を `data-theme` に連動)。

## DON'T(やらないこと)

- 外部CDN(jsdelivr / cdnjs / unpkg 等)参照の追加。工場内ネットワーク遮断で画面が崩壊する。
- ページ内 `<style>` ブロックへの色・サイズのハードコード。
- `localStorage` への業務データ(検品結果等)保存。業務データのオフライン保持は IndexedDB。localStorage は UI設定(モード・テーマ・検品者)のみ。
- 実験・旧版ページの web/ 直下への配置(→ `web/_archive/`)。
- 独自ヘッダー・ページごとのナビ実装(→ `js/layout.js`)。絶対URL・別ポートのAPI呼び出し(nginxプロキシ前提)。

## OUTPUT FORMAT(完了条件)

作成・修正後、以下を確認した旨を報告してから完了とする:
1. CDN参照が増えていない(`grep -r "cdn" 対象ファイル`)
2. 色・サイズのハードコードなし(tokens変数参照)
3. ボタン 48px / 現場操作 64px 以上
4. iPhone幅(390px)でレイアウト非破壊
5. `data-page` と共通ナビのアクティブ表示が一致
