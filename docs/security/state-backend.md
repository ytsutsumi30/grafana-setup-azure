# Terraform state のリモートバックエンド移行手順 (D7)

作成: 2026-07-06 / 対象: infra/terraform

## 背景

- 現状、`infra/terraform/terraform.tfstate`(+ .backup)がローカル作業ツリーに存在する。tfstate は DB 接続文字列や生成パスワード等の機微情報を平文で含みうる。
- git 追跡はされていない(.gitignore が `*.tfstate*` をカバー済み)。したがって Git 経由の漏洩リスクは低いが、ローカルファイル/バックアップ経由の漏洩リスクと、複数人・複数端末での state 競合リスクが残る。
- 対策: state を Azure Storage(blob)のリモートバックエンドへ移行し、ローカル tfstate を削除する。

## 手順

### 1. state 保管用の Storage を作成(一度だけ)

```bash
RG=rg-tfstate
LOC=japaneast
SA=sttfstate$RANDOM      # グローバル一意な小文字英数
CONTAINER=tfstate

az group create -n $RG -l $LOC
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS --encryption-services blob --min-tls-version TLS1_2
az storage container create -n $CONTAINER --account-name $SA
echo "backend storage account: $SA"
```

state に機微情報が入るため、Storage は最小権限(RBAC)+ ネットワーク制限を推奨。可能なら public network access を無効化し、信頼できるサービス経由のみ許可。

### 2. backend 定義を追加

`infra/terraform/backend.tf`(新規):

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-tfstate"
    storage_account_name = "<上で作成した SA 名>"
    container_name       = "tfstate"
    key                  = "shipping-inspection.tfstate"
  }
}
```

storage_account_name は環境依存のため、backend.tf はコミットしてよいが、値はレビューで確認する。より厳密には `-backend-config` で外出しする:

```bash
# backend.tf では storage_account_name を空にし、init 時に渡す
terraform init -backend-config="storage_account_name=$SA"
```

### 3. ローカル state を移行

```bash
cd infra/terraform
terraform init -migrate-state    # 既存ローカル state を Azure へ移行するか聞かれる → yes
terraform plan                   # 差分が出ないこと(no changes)を確認
```

### 4. ローカル state を削除

移行成功を確認したら、ローカルの平文 state を消す。

```bash
rm -f terraform.tfstate terraform.tfstate.backup
# .gitignore で既に無視されているが、作業ツリーから物理削除する
```

### 5. 認証情報の扱い

- terraform.tfvars(ローカル)は git 未追跡のまま維持。値は 1Password / Key Vault 等で管理し、tfvars は端末ローカルのみ。
- supabase-project.json も git 未追跡。不要なら削除、必要なら同様にローカル限定。
- CI で apply する場合は、サービスプリンシパル + OIDC で認証し、tfvars の機微値は CI シークレットから注入する。

## 完了条件

```text
terraform.tfstate がローカル作業ツリーに存在しない。
terraform plan が Azure backend を参照し、no changes を返す。
Storage が最小権限・TLS1.2・(可能なら)public access 無効。
terraform.tfvars / supabase-project.json が git 未追跡のまま(git ls-files で不在)。
```

## 注意

- `-migrate-state` は既存インフラを変更しない(state の保管場所だけを移す)操作。plan で no changes を必ず確認すること。
- 移行中は他者が apply しないよう調整する(state ロック競合防止)。
