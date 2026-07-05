---
name: prj3-frontend
description: 出荷検品アプリ (prj3) のフロントエンド規約。web/ 配下の HTML・CSS・JS を新規作成・修正・リファクタリングするとき、画面やコンポーネントを追加するとき、検品・ピッキング・棚卸・在庫・受発注などの現場向け画面を作るとき、デザイントークンやダークテーマ、スキャン UI、PWA/オフライン対応を扱うときは必ずこのスキルを使うこと。「画面を作って」「UI を直して」「ページを追加」のような曖昧な依頼でも prj3 の web 配下が対象なら適用する。
---

# prj3 フロントエンド規約

出荷検品アプリ(静的 HTML + Vanilla JS + nginx 配信)の画面を作る・直すときの規約。目的は 2 つ: (1) 現場端末(手袋・屋内 Wi-Fi・iOS Safari)で確実に使えること、(2) どの画面も同じ流儀で書かれ、共通基盤の修正が全画面に効くこと。

## 必ず守る構造

新規ページは次の骨格から始める。既存ページを修正するときも、この構造に近づける方向で直す。

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
  <script src="js/layout.js"></script>  <!-- 共通ヘッダー・ナビを挿入 -->
  <main class="container">...</main>
  <script src="js/pages/ページID.js"></script>
</body>
</html>
```

理由: ヘッダー・ナビ・スタイルをページごとに書くと修正が波及しない。これが本プロジェクト最大の負債だったので、逆行する書き方(ページ内 `<style>` ブロック、独自ヘッダー)を新たに増やさない。

## 禁止事項と代替

- 外部 CDN(jsdelivr / cdnjs / unpkg 等)への参照は追加しない。工場内ネットワークで遮断されると画面が崩壊する。ライブラリは `web/vendor/` に置いて相対参照する。
- ページ内の `<style>` ブロックに色・サイズをハードコードしない。`css/tokens.css` の CSS 変数を使う。ページ固有スタイルがどうしても必要な場合のみ `css/pages/ページID.css` を作る。
- `localStorage` に業務データ(検品結果等)を保存しない。業務データのオフライン保持は IndexedDB キュー(後述)。localStorage は UI 設定(モード、テーマ、検品者)のみ。
- 実験・旧版ページを web/ 直下に置かない。`web/_archive/` へ。

## デザイントークン

色・サイズは必ず変数参照。代表的なもの:

```css
--color-status-ok: #198754;      /* 合格・完了 */
--color-status-ng: #dc3545;      /* 不合格・エラー */
--color-status-pending: #ffc107; /* 待ち・保留 */
--color-status-progress: #0dcaf0;
--touch-target-min: 48px;        /* すべてのボタンの最小 */
--touch-target-field: 64px;      /* 現場操作(OK/NG/完了)の最小 */
```

ステータス表示はバッジ共通クラス(`badge-ok` / `badge-ng` / `badge-pending`)を使い、画面ごとに色を再定義しない。ダークテーマは `[data-theme="dark"]` での変数上書きだけで成立させる(セレクタ単位の上書きを書かない)。

## 現場向け画面の基準

検品・ピッキング・棚卸などスキャン操作を含む画面では:

- 1 画面 1 タスク。ナビゲーションは最小限、ホームボタンのみ常設。
- 主要アクション(完了 / NG / 取消)は画面下部の sticky アクションバーに固定する(親指圏)。サイズは `--touch-target-field` 以上。
- 進捗(例: 「3/12 スキャン済み」)を大きく常時表示する。
- スキャン結果のフィードバックは 3 チャネル同時: 画面フラッシュ(成功=緑 / 失敗=赤 / 重複=黄)+ ビープ(成功=短 1 回 / 失敗=低 2 回)+ バイブ(`navigator.vibrate`、成功 1 回 / 失敗 2 回)。現場では画面を注視せず連続スキャンするため、音とバイブを省略しない。
- 直前スキャンの取り消し(Undo)を必ず用意する。
- 検品者・作業者はセッション記憶(localStorage)し、毎回選択させない。

## API 呼び出し

- 同一オリジンの `/api/...` を fetch する。絶対 URL・別ポートを書かない(nginx が API へプロキシする前提)。
- 失敗時は共通トースト(`showToast(message, type)`)で通知し、silent fail にしない。
- スキャン系の POST はオフライン考慮: 送信失敗時は IndexedDB キュー(`js/offline-queue.js`)へ保存し、`online` イベントで再送する。UI には送信済み / 未送信をアイコンで示す。

## Grafana 埋め込み

モニタリング表示は Chart.js を新規実装せず、同一オリジンの Grafana iframe を使う:

```html
<iframe src="/grafana/d-solo/<uid>/<slug>?orgId=1&panelId=2&from=now-6h&to=now&refresh=30s&theme=light"
        width="100%" height="300" frameborder="0"></iframe>
```

テーマはアプリの `data-theme` に合わせて `theme=light|dark` を切り替える。

## 完了前チェック

画面を作成・修正したら、次を確認してから完了とする:

1. 外部 CDN 参照が増えていない(`grep -r "cdn" 対象ファイル`)
2. 色・サイズのハードコードがない(tokens 変数を参照している)
3. ボタンサイズが基準を満たす(通常 48px / 現場操作 64px)
4. iPhone 幅(390px)でレイアウトが崩れない
5. `data-page` と共通ナビのアクティブ表示が一致している
