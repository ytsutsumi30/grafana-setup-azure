---
name: skill-creator
description: Claude Skill を新規作成・改修・評価するとき。「スキルを作って」「このスキルを改善して」「descriptionの発火精度を上げて」「スキルをテスト/評価して」等。スキル以外の一般的なドキュメント作成には使わない。
---

# Skill Creator(スキルの作成・改善・評価)

## DO(やること)

1. 意図の把握: 何をするスキルか、発火してほしい状況/してほしくない状況をヒアリング(相手の技術習熟度に語彙を合わせる)。
2. ドラフト: SKILL.md を書く。frontmatterは name + description(発火条件を具体的な状況で)。本文は必要最小限にし、詳細・大きな知識は references/ scripts/ へ委譲(progressive disclosure)。驚き最小の原則に従う。
3. 評価: テストプロンプトを数件作成し、with-skill と baseline を同一ターンで並行実行 → 実行中にアサーション(定量評価)を起草 → 完了分から所要時間を記録 → 採点・集計し `eval-viewer/generate_review.py` でユーザーにレビューしてもらう。
4. 反復: ユーザーの定性フィードバックと定量結果を反映して書き直し、テストセットを広げて再評価。
5. 仕上げ: `scripts/improve_description.py` で発火精度を最適化。配布時は `scripts/package_skill.py`。ブラインド比較は agents/comparator.md を利用。

## DON'T(やらないこと)

- 評価なしで「完成」と宣言(ユーザーが省略を明示した場合を除く)。
- SKILL.md本文への長大な知識の直書き(references/ へ)。
- 評価用スクリプトのソースを不必要に読み込む(まず --help、ブラックボックスとして使う)。

## OUTPUT FORMAT(出力の型)

- スキル一式: `<name>/SKILL.md`(+必要に応じ references/ scripts/ assets/)
- 評価レポート: Executive summary / Key findings / Recommendations
- 変更時のコミットメッセージ(目的1行+要点)
