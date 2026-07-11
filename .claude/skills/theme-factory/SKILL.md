---
name: theme-factory
description: スライド・ドキュメント・レポート・HTMLページ等の成果物に、統一されたテーマ(配色+フォントペア)を選定・生成して適用するとき。「テーマを当てて」「トーンを揃えて」「ライト/ダーク用のカラートークンを作って」等。10種のプリセット(themes/)から選ぶか、新規テーマを生成する。prj3 web/ の実装トークンは css/tokens.css が正であり、本Skillで置き換えない。
license: Complete terms in LICENSE.txt
---

# Theme Factory(テーマ選定・生成・適用)

## DO(やること)

1. `theme-showcase.pdf` を提示して全10テーマ(Ocean Depths / Sunset Boulevard / Forest Canopy / Modern Minimalist / Golden Hour / Arctic Frost / Desert Rose / Tech Innovation / Botanical Garden / Midnight Galaxy)を見せる(変更せず表示のみ)。
2. どれを適用するか選択を待つ(明示確認)。
3. 選択後 `themes/<テーマ名>.md` を読み、色・フォントを成果物全体へ一貫適用。コントラストと可読性を確認。
4. 既存テーマが合わない場合のみ新規生成: 同形式(内容を表す名前+hexパレット+見出し/本文フォントペア)で提示→レビュー→適用。

## DON'T(やらないこと)

- 選択確認前の適用。showcase PDF の改変。
- テーマ定義外の色・フォントの持ち込み(適用中はテーマ定義が唯一のソース)。
- prj3 web/ の css/tokens.css の値の書き換え(そちらは prj3-frontend の管轄)。

## OUTPUT FORMAT(出力の型)

- 適用テーマ仕様(名前 / hexパレット / 見出し・本文フォント)
- テーマ適用済みの成果物
