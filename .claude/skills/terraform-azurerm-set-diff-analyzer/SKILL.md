---
name: terraform-azurerm-set-diff-analyzer
description: AzureRM Providerの terraform plan 出力をJSON解析し、Set型属性の順序変化による偽陽性diffと実変更を区別するとき。「planの差分が多すぎる」「Application Gateway/Load Balancer/NSG/Front Door/Firewallで全要素changedになる」「CI/CDでplanレビューを自動化したい」等。Azure以外のproviderの一般的なplanレビューには使わない。
license: MIT
---

# Terraform AzureRM Set Diff Analyzer

背景: TerraformのSet型は位置比較のため、要素の追加/削除で全要素が「変更」に見える。AzureRMのSet型多用リソースで顕著。

## DO(やること)

```bash
terraform plan -out=plan.tfplan
terraform show -json plan.tfplan > plan.json
python scripts/analyze_plan.py plan.json   # python3でも可・標準ライブラリのみ(3.8+)
```

- 対応リソース・属性は `references/azurerm_set_attributes.md` を確認する。
- 全オプション・出力形式・exit code・CI/CD組込例は `scripts/README.md`。

## DON'T(やらないこと)

- JSON planなしの目視判定(人手でのSet属性diff読解は誤りやすい)。
- 偽陽性と実変更の混在報告(必ず区別して提示)。
- 解析スクリプトへの依存ライブラリ追加(標準ライブラリ維持)。

## OUTPUT FORMAT(出力の型)

- 判定表: リソース → 偽陽性(順序のみ) / 実変更(内容) の区分と根拠
- 実変更のみの要約(applyの判断材料)
- CI利用時は exit code の意味(scripts/README.md 準拠)を併記
