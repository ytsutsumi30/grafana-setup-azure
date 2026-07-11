---
name: prd
description: 新機能・新プロダクトの要件定義書(PRD)を作るとき。「PRDを書いて」「要件定義して」「この機能を計画して」、曖昧なアイデアを仕様へ落とすとき(例: 受発注・製造指図の要件定義)。実装作業・技術調査・既存仕様の説明には使わない。
license: MIT
---

# PRD(要件定義書の作成)

## DO(やること)

- 着手前に必ず2問以上の確認質問(Discovery): 解決したい課題は何か / 成功指標は何か / 制約(予算・スタック・期限)は何か。
- 測定可能な基準で書く(NG「速い・使いやすい」→ OK「10k件データセットで200ms以内」「Precision@10 85%以上」「Lighthouse a11y 100点」)。
- Non-Goals(作らないもの)を明記してスコープを守る。ユーザーフローと隠れた依存関係を洗い出す。
- ドラフト提示後、セクション単位でフィードバックを求めて反復する。
- AI機能を含む場合は評価戦略(ベンチマーク・合格基準・必要ツール)を必ず定義する。

## DON'T(やらないこと)

- Discovery省略(質問なしでいきなり書かない)。
- 制約の捏造(未指定のスタック等は質問するか `TBD` と明記)。
- PRD完成前の実装着手。

## OUTPUT FORMAT(出力の型)— 固定スキーマ

1. Executive Summary(Problem / Solution 各1〜2文、測定可能なKPI 3〜5個)
2. UX & Functionality(Personas / User Stories `As a [user], I want [action] so that [benefit].` / 各StoryのAcceptance Criteria / Non-Goals)
3. AI System Requirements(該当時: 必要ツール・API / 評価戦略)
4. Technical Specifications(アーキテクチャ概要 / 連携点: API・DB・認証 / セキュリティ・プライバシー)
5. Risks & Roadmap(段階的ロールアウト MVP→v1.1→v2.0 / 技術リスク)
