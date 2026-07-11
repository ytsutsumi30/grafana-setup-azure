# NotebookLM 連携パック

このフォルダは、NotebookLM に投入するための資料パックです。

## 投入対象

まず以下を NotebookLM のソースとして追加してください。

1. `00-notebooklm-project-brief.md`
2. `source-index.md`
3. `sources/` 配下の Markdown ファイル

## ソース構成

- `00-notebooklm-project-brief.md`: NotebookLM が最初に読む前提説明。
- `source-index.md`: 各資料の役割と読む順番。
- `sources/`: 既存プロジェクト資料から NotebookLM 向けに選定した資料。

## 推奨ノート名

`出荷検品・製造業務 POC 計画`

## NotebookLM への登録手順

1. NotebookLM で新しいノートを作成する。
2. ソース追加からファイルアップロード、または Google Drive 連携を選ぶ。
3. このフォルダ内の `00-notebooklm-project-brief.md` と `source-index.md` を先に追加する。
4. `sources/` 配下の資料を追加する。
5. NotebookLM の読み込み完了後、概要、FAQ、ブリーフィング資料を生成する。

## 注意

- Terraform state、`terraform.tfvars`、Supabase 接続情報、アクセストークン、秘密鍵は NotebookLM に投入しない。
- ソースコード全体は投入しない。仕様確認には docs と README を優先する。
- 監査・セキュリティレビューをする場合のみ、必要な API/DB 定義を個別に追加する。
