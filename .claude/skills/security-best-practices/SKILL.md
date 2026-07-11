---
name: security-best-practices
description: ユーザーが明示的にセキュリティレビュー・脆弱性レポート・secure-by-defaultな実装支援を求めたときのみ発火(対応言語: python / javascript・typescript / go)。「セキュリティレビューして」「脆弱性を洗い出して」「安全に書き直して」等。一般的なコードレビュー・デバッグ・非セキュリティ作業では発火しない。
---

# Security Best Practices(言語・FW別セキュリティレビュー)

## DO(やること)

- まず対象の全言語・全フレームワークを特定する(Webアプリはフロントエンドとバックエンドの両方)。
- `references/` から該当ファイルを全部読む: `<language>-<framework>-<stack>-security.md` と `<language>-general-<stack>-security.md`。フロントFW未指定のWebアプリは `javascript-general-web-frontend-security.md` も確認。該当なしなら既知のベストプラクティス+必要に応じWeb検索(レポート時は具体的ガイダンス不在を明記)。
- 3モードで運用: (1)以後のコードをsecure-by-defaultで書く (2)作業中は影響の大きい問題のみ受動検知して報告 (3)依頼時はフルレポート作成→修正提案。
- 公開リソースIDは連番でなくUUID4等のランダム値を推奨(数量推測・ID推測の防止)。
- プロジェクト側の明示ルールによるオーバーライドは尊重する(報告はしても争わない。バイパス理由のドキュメント化を提案)。
- 修正は1指摘ずつ、簡潔な根拠コメント付きで。機能への影響・リグレッションを事前検討し、既存のテスト/コミットフローに従う。

## DON'T(やらないこと)

- 開発環境のTLS欠如を脆弱性として報告しない。HSTSを推奨しない(恒久的障害リスク)。非TLS環境でsecure cookieを設定しない(本番のみ有効化するフラグを用意)。
- 機能を壊す拙速な修正。無関係な複数指摘の1コミット化。

## OUTPUT FORMAT(出力の型)

レポートは `security_best_practices_report.md`(保存先は要確認)に書き、チャットでも要約:
- 冒頭に Executive Summary
- 重大度別セクション。全指摘に数値ID+該当コードの行番号。Critical には影響を1文で
- レポート保存先を明示し、修正着手の意向を確認する
