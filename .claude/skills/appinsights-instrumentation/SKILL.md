---
name: appinsights-instrumentation
description: AzureホストのWebアプリにApplication Insightsのテレメトリ計装を追加・強化するとき。「App Insightsを入れて」「テレメトリ/分散トレースを追加して」「カスタムイベント・メトリクスを送りたい」「可用性監視を設定して」等。Grafana/Prometheus系の監視、一般的なログ設計、Azure以外のホスティングには使わない。
---

# App Insights 計装

## DO(やること)

1. (言語, フレームワーク, ホスティング)の3点を特定する。コードから推定しつつ、ホスティング先(App Service code/container・Container Apps・ローカル等)は必ずユーザーに確認する。
2. ASP.NET Core + App Service なら自動計装を優先: `references/AUTO.md`。
3. それ以外は手動計装:
   - リソース作成: 既存Bicepがあれば `examples/appinsights.bicep` を参考に追記 / なければ `scripts/appinsights.ps1` のAzure CLI。リソースグループはアプリ本体と同じ場所を推奨。
   - コード修正: ASP.NET Core→`references/ASPNETCORE.md` / Node.js→`references/NODEJS.md` / Python→`references/PYTHON.md`。

## DON'T(やらないこと)

- ホスティング先を確認せずに計装方式を決めない。
- 接続文字列のハードコード(環境変数・アプリ設定を使う)。
- Grafana/Prometheus監視の設計(スコープ外。prj3のモニタリングUIは prj3-frontend のGrafana埋め込み規約)。

## OUTPUT FORMAT(出力の型)

1. 判定した3点セット(言語 / FW / ホスティング)と選択した計装方式
2. リソース作成手順(Bicep差分 or CLIコマンド)
3. コード変更の差分
4. 検証手順(ポータルのLive Metrics / ログでテレメトリ到達を確認する方法)
