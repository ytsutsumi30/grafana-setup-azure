# UI 改善実施ログ

UI 改善ループの意思決定と検証結果を、実施ごとに短く追記する。

## 記録テンプレート

### YYYY-MM-DD: 対象画面 / 改善テーマ

- 選定理由:
- 受入条件:
- 変更ファイル:
- 検証コマンド:
- 検証結果: dev stack / HTTP / screenshot / console / tests
- 人の画面確認:
- 残存リスク:

## 実施記録

### 2026-07-18: inventory-foundation / 先進的な在庫オペレーション・コンソール

- 選定理由: Bootstrap標準のカードと大型青ヘッダーへの依存、状態・数量の弱い情報階層、モバイル表の横スクロールを解消するため。
- 受入条件: 最大10ループ内、desktop/mobile表示正常、console error 0件、横はみ出し0、通常ボタン48px以上、QR操作64px以上、関連テスト成功。
- 実施ループ: 共通トークン・ヘッダー、コマンドバー、KPIレール、在庫表、QR照会、移動タイムライン、UI状態・mobile/dark、統合検証の8回。
- 変更ファイル: `web/inventory-foundation.html`、`web/css/tokens.css`、`web/css/components.css`、`web/css/pages/inventory-foundation.css`、`web/js/layout.js`、`web/js/pages/inventory-foundation.js`、`tests/ui/inventory-foundation.test.js`。
- 検証コマンド: `BASE=http://localhost:8080 node --test tests/ui/inventory-foundation.test.js`、`npm --prefix api run check:syntax`。
- 検証結果: UIテスト2件成功、console error 0件、390px横はみ出し0、タッチ領域適合、API構文検査成功、外部CDN・ページ固有ハードコード色0件。
- 人の画面確認: デスクトップdark、390px lightのスクリーンショットで重なり、切れ、カード内カードを修正後に再確認。
- 残存リスク: 実データが大量の場合の仮想スクロールと、実機スキャナー固有のEnter終端設定は別途検証が必要。

### 2026-07-17: shipping-instructions / ループ導入確認

- 選定理由: UI改善ループの検証ゲートが実環境で動作することを確認するため。
- 受入条件: dev stack起動、対象画面HTTP 200、スクリーンショット生成、console error 0件、スモーク成功、関連APIテスト成功。
- 変更ファイル: UI変更なし。ループ定義、検証スクリプト、テスト手順のみ。
- 検証コマンド: `TARGET_PAGE=shipping-instructions RELATED_TESTS='tests/api/contract.test.js' bash scripts/verify-ui-change.sh`
- 検証結果: PASS。console error 0件、API契約テスト47件成功。
- 人の画面確認: 一覧、進捗、操作列が表示され、要素の重なりは見られない。
- 残存リスク: デスクトップ幅のみ確認。表見出しの折返しは次回のUI改善候補。
