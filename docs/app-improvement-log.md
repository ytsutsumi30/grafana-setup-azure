# アプリ改善実施ログ

アプリ改善ループの候補評価、意思決定、検証結果を実施ごとに追記する。

## 記録テンプレート

### YYYY-MM-DD: 対象業務 / 改善テーマ

- 対象画面:
- 候補上位3件と点数:
- 選定理由:
- 受入条件:
- 変更ファイル:
- 関連テスト:
- 検証結果: dev stack / HTTP / screenshot / console / smoke / tests
- 人の確認:
- 残存リスク:

## 実施記録

### 2026-07-17: 発注・入庫 / アプリ改善ループ導入確認

- 対象画面: `purchase-receiving.html`
- 候補上位3件と点数: 改善実装前のループ導入確認のため採点対象外。
- 選定理由: アプリ拡張画面でも必須検証ゲートが動作することを確認するため。
- 受入条件: dev stack起動、HTTP 200、スクリーンショット生成、console error 0件、スモーク成功、関連APIテスト成功。
- 変更ファイル: アプリ機能変更なし。ループ定義と運用文書のみ。
- 関連テスト: `tests/api/contract.test.js`
- 検証結果: PASS。console error 0件、HTTPスモーク成功、API契約テスト47件成功。
- 人の確認: 発注入力、KPI、発注・入庫予定一覧が重なりなく表示される。
- 残存リスク: デスクトップ幅のみ確認。入庫予定未選択時の広い空白領域は今後の改善候補。

### 2026-07-17: 発注・入庫 / 入庫完了操作の安全化

- 対象画面: `purchase-receiving.html`
- 候補上位3件と点数: 入庫完了の誤操作防止 33点、完了明細のスキャン・残数量超過の事前抑止 23点、登録処理中の二重クリック防止 23点。
- 選定理由: 完了操作は業務状態を確定し、この画面から追加実績を登録できなくなる一方、従来は未完・完了済みでもボタンが有効で確認なしにAPIへ進んでいたため。
- 受入条件: 未完時は無効化と残数理由表示、完了済みは再実行不可、完了可能時も確認モーダル必須、確定前はPATCHなし、確定中の二重送信なし。
- 変更ファイル: `web/purchase-receiving.html`、`web/js/pages/purchase-receiving.js`、`web/css/pages/purchase-receiving.css`、`tests/ui/purchase-receiving.test.js`。
- 関連テスト: `tests/api/contract.test.js`、`tests/ui/purchase-receiving.test.js`。
- 検証結果: 3回目でPASS。dev stack正常、HTTP 200、console error 0件、HTTPスモーク成功、API契約47件と変更固有UIテスト1件の計48件成功。
- 人の確認: 390px幅で確認対象、数量、注意文、取消・確定操作が重なりなく表示される。証跡は `artifacts/ui-verification/purchase-receiving-confirm-mobile.png`。
- 残存リスク: 完了明細が入庫スキャン選択肢に残る点と、スキャン・発注登録ボタンの多重送信防止は次回候補。M365サインイン必須構成での操作確認は別途必要。

### 2026-07-17: 発注・入庫 / 入庫スキャンの残数量制御

- 対象画面: `purchase-receiving.html`
- 候補上位3件と点数: 完了明細・残数量超過の事前抑止 26点、登録処理中の二重送信防止 23点、未選択時の空白領域改善 14点。
- 選定理由: 完了済み明細への追加登録と予定数量を超える入庫は在庫・ロット実績を直接不整合にするため、画面で最優先に抑止する。
- 受入条件: スキャン対象は未完了明細のみ、入庫数量の上限は残数量に同期、超過時は警告してAPIを呼ばない、対象明細がない場合は全入力を無効化、入庫予定切替時に制約を再計算する。
- 変更ファイル: `web/purchase-receiving.html`、`web/js/pages/purchase-receiving.js`、`tests/ui/purchase-receiving.test.js`。
- 関連テスト: `tests/api/contract.test.js`、`tests/ui/purchase-receiving.test.js`。
- 検証結果: 1回目でPASS。dev stack正常、HTTP 200、console error 0件、HTTPスモーク成功、API契約47件と変更固有UIテスト1件の計48件成功。
- 人の確認: 390px幅で完了済み案内、スキャン入力の無効状態、確認モーダルを確認し、横方向のはみ出しや重なりがない。証跡は `artifacts/ui-verification/purchase-receiving-mobile.png`。
- 残存リスク: 入庫スキャン・発注登録の通信中にボタンを無効化する二重送信防止が次優先。M365サインイン必須構成での操作確認は別途必要。

### 2026-07-17: 発注・入庫 / 更新操作の二重送信防止

- 対象画面: `purchase-receiving.html`
- 候補上位3件と点数: 更新操作の二重送信防止 26点、発注作成後に入庫予定作成だけ失敗した場合の再実行整合性 24点、未選択時の空白領域改善 14点。
- 選定理由: 発注・入庫予定・入庫実績の重複作成は数量とロット実績を不整合にするため、画面側で同時送信を最優先に抑止する。
- 受入条件: 各操作の連打でもPOSTは1回、通信中は対象ボタンを無効化して処理中表示、成功後は業務状態に従って復帰、失敗後は入力値を保持して再操作可能、既存の残数量・完了制御を維持する。
- 変更ファイル: `web/js/pages/purchase-receiving.js`、`tests/ui/purchase-receiving.test.js`。
- 関連テスト: `tests/api/contract.test.js`、`tests/ui/purchase-receiving.test.js`。
- 検証結果: 3回目でPASS。1回目は意図的なHTTP 500がconsole error条件に抵触し、2回目はテスト用拒否が即時完了して処理中表示を観測できなかったためテストを修正した。dev stack正常、HTTP 200、console error 0件、HTTPスモーク成功、API契約47件と変更固有UIテスト1件の計48件成功。
- 人の確認: 390px幅で入庫登録ボタンの処理中表示、スピナー、無効状態を確認し、ボタン幅の変化や周辺要素との重なりがない。証跡は `artifacts/ui-verification/purchase-receiving-scan-busy-mobile.png`。
- 残存リスク: 発注作成成功後に入庫予定作成だけ失敗すると、再実行で発注が重複する可能性がある。次回はAPIの冪等性または既存発注からの再開導線を検討する。M365サインイン必須構成での操作確認は別途必要。

### 2026-07-19: 在庫・入出荷 / 専門エージェント指摘の優先修正ループ

- 対象画面: `inventory-foundation.html`、`purchase-receiving.html`、`qr-inspection.html`、および在庫・入出荷API。
- 評価体制: `domain-architect`、`frontend-qa`、`release-verifier` が読み取り専用で並列レビューし、主エージェントだけがソースコードを変更した。
- 実行上限: 最大10ループ。重大度とデータ不整合の影響が高い順に10件を実施した。
- Loop 1: 在庫台帳整合性マイグレーションをDocker起動とAzureリリース手順へ組み込み、実DBテストを追加。
- Loop 2: ピッキング完了をトランザクション化し、再実行時に在庫を二重払出ししない冪等処理へ変更。
- Loop 3: 在庫残高キーへQR個体IDを含め、同一ロット内の複数QR残高とロット合計を分離して保持。
- Loop 4: 在庫状態値を `available`、`reserved`、`on_hold`、`defective` に統一。
- Loop 5: 入庫時のQR個体ID再割当てを禁止し、品目・ロット不一致を409で拒否。
- Loop 6: 入庫登録へ `Idempotency-Key` を導入し、通信再試行による入庫実績・在庫の重複登録を防止。
- Loop 7: 出荷完了後訂正で品目明細数量を超えるロット配分を409で拒否し、副作用がないことをテスト。
- Loop 8: 在庫残高と移動履歴を独立取得し、一方のAPI障害でも取得済みデータを表示。
- Loop 9: console検証へ同一オリジンの `/api/` HTTPエラー検出を追加。
- Loop 10: QR検品画面のBootstrap、Font Awesome、`html5-qrcode` をローカル資産へ切り替え、外部CDN依存を除去。
- 専門再レビュー後の収束修正: QR照合台帳へQR個体IDを保存し、ロット集約残高が存在する場合はQR内訳との二重計上を防止。取消済みロット訂正、不正状態のピッキング完了、単一QRへの複数在庫状態を拒否した。
- 専門再レビュー後の収束修正: 製造払出を `available` 在庫からの減算として補正し、基準スキーマへ台帳状態列と残高非負制約を反映。入庫画面を部分API障害に耐える独立取得へ変更した。
- リリースゲート強化: 実DB・PPS・UI・consoleテストをCIへ追加し、QR検品を既定console検証とService Workerキャッシュへ追加。Azure更新手順へrevision確認、公開ヘルス確認、旧イメージ復元を追加した。
- 追加検出修正: 既定console検証で検出した監視APIの旧列参照と、監視・QC画面の数値文字列・`null` 表示エラーを修正した。
- 受入条件: Docker dev stack正常、対象画面HTTP 200、console error 0件、HTTPスモーク成功、API構文検査、単体・API・UI・実DB関連テスト成功。
- 検証結果: PASS。`qr-inspection.html` の外部URL参照0件、既定9画面のconsole error 0件、HTTPスモーク成功、関連64テスト、API単体18テスト成功、依存脆弱性0件。Terraform、Compose、シェル構文、差分整合性も成功。証跡は `artifacts/ui-verification/qr-inspection.png`。
- 残存リスク: Supabase本番DBへのマイグレーション適用、M365有効状態での実機QRカメラ確認、棚卸・製造実績の共通在庫台帳化、発注と入庫予定作成のAPIトランザクション化、入庫冪等キーのページ再読込を越えた保持、Supabase接続のTLS証明書検証、Azure Container Appsへのリリースは未実施。新規ファイルはGitへ未登録のため、コミット前に追跡対象の確認が必要。
