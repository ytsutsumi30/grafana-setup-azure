---
name: azure-resource-visualizer
description: Azureリソースグループの実構成を調査してMermaidアーキテクチャ図を生成するとき。「Azureの構成図を作って」「リソースの関係を図解して」「ACA構成をドキュメント化して」等。AWS等の他クラウドや、コードからの論理アーキテクチャ図には使わない。
license: Complete terms in LICENSE.txt
metadata:
  author: Tom Meschter (tom.meschter@microsoft.com)
---

# Azure Resource Visualizer(構成図生成)

## DO(やること)

1. リソースグループ未指定なら一覧を番号付きで提示(専用ツールが無ければ `az` CLI)→ 選択を待つ。指定済みなら存在確認して続行。
2. 読み取り専用の `az` クエリでリソース・設定・依存関係(ネットワーク / マネージドID / 接続参照 / 診断設定)を調査する。
3. `assets/template-architecture.md` の構成に従い、Mermaid図+リソース表を含むMarkdownを生成する。

## DON'T(やらないこと)

- 確認していないリソース・関係の創作(図の全要素はクエリ結果に基づく)。
- 書き込み系 `az` コマンドの実行。
- 接続文字列・キー等の秘匿値の出力(存在の言及のみ可)。

## OUTPUT FORMAT(出力の型)

- Markdownファイル: 概要 → Mermaid図(サブグラフでリソース種別を層別)→ リソース一覧表(名前 / 種別 / SKU / リージョン)→ 関係の説明
- 図はMermaid構文として妥当であること(レンダリング確認)
