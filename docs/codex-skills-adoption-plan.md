# Codex Desktop 向け Skills 適用計画

この文書は、現在 Claude Code Desktop 向けに導入済みの `.claude/skills` を、Codex Desktop でも利用できるようにするための確認結果と適用計画です。

## 結論

Codex Desktop でも利用可能です。

ただし、Claude Code のプロジェクトローカル配置である `.claude/skills` は、Codex Desktop の自動スキル探索対象ではありません。Codex で自動発動させるには、Codex のスキルルートへコピーする必要があります。

推奨コピー先:

```text
C:\Users\tsuts\.codex\skills\<skill-name>\SKILL.md
```

既存の Azure 系スキルは以下に配置されていますが、ここは管理済みスキルが多いため、プロジェクト専用スキルの追加先としては `.codex\skills` を推奨します。

```text
C:\Users\tsuts\.agents\skills
```

## 現在の配置状況

### Claude Code 側

WSL 側の出荷検品プロジェクトには以下があります。

```text
/home/tsutsumi/grafana-setup-azure/.claude/skills/
```

導入済みスキル:

```text
appinsights-instrumentation
azure-resource-visualizer
doc-coauthoring
frontend-design
playwright
prd
prj3-frontend
refactor
security-best-practices
security-threat-model
skill-creator
terraform-azurerm-set-diff-analyzer
theme-factory
web-artifacts-builder
web-design-reviewer
webapp-testing
```

Google Drive 側にはプロジェクト専用スキルのみがあります。

```text
G:\マイドライブ\AI-Memory\projects\prj3\skills\prj3-frontend\SKILL.md
```

### Codex Desktop 側

現在の Codex 側ユーザースキルは以下です。

```text
C:\Users\tsuts\.codex\skills\.system
C:\Users\tsuts\.codex\skills\cloudflare-deploy
```

このため、`prj3-frontend` などの出荷検品プロジェクト用スキルは、現時点では Codex Desktop の自動スキル一覧には出ません。

## 互換性

`SKILL.md` の frontmatter は Codex のスキル形式と互換です。

例:

```yaml
---
name: prj3-frontend
description: 出荷検品アプリ (prj3) のフロントエンド規約...
---
```

そのため、基本的にはディレクトリごとコピーすれば利用できます。

ただし、以下は注意が必要です。

- Claude Code 固有の記述は Codex 用に読み替える。
- `agents/` 配下のサブエージェント定義は Codex で同じ動きになるとは限らない。
- `scripts/` と `references/` は利用可能だが、Codex が必要時に読むよう `SKILL.md` に明記されている必要がある。
- 既に Codex に同等スキルがあるものは重複導入しない。

## Codex へ導入する優先順位

### 最優先

```text
prj3-frontend
security-best-practices
security-threat-model
refactor
playwright
webapp-testing
```

理由:

- UI 改善、技術的負債解消、API 分割、テスト整備に直結するため。

### 次点

```text
theme-factory
web-design-reviewer
frontend-design
terraform-azurerm-set-diff-analyzer
prd
doc-coauthoring
web-artifacts-builder
```

理由:

- 設計文書、UI 品質、Terraform 差分確認に有効。

### 導入不要または既存で代替可能

```text
appinsights-instrumentation
azure-resource-visualizer
skill-creator
```

理由:

- Codex 側に Azure 系スキルや `skill-creator` が既に存在するため、必要時は既存スキルを優先する。

## 適用方法

### 方法 A: 個人用 Codex スキルとしてコピーする

最も簡単で推奨です。

PowerShell:

```powershell
$src = "\\wsl.localhost\Ubuntu-22.04\home\tsutsumi\grafana-setup-azure\.claude\skills"
$dst = "C:\Users\tsuts\.codex\skills"

$skills = @(
  "prj3-frontend",
  "security-best-practices",
  "security-threat-model",
  "refactor",
  "playwright",
  "webapp-testing",
  "theme-factory",
  "web-design-reviewer",
  "frontend-design",
  "terraform-azurerm-set-diff-analyzer",
  "prd",
  "doc-coauthoring",
  "web-artifacts-builder"
)

foreach ($s in $skills) {
  Copy-Item -LiteralPath "$src\$s" -Destination "$dst\$s" -Recurse -Force
}
```

反映後、Codex Desktop の新しいスレッドでスキル一覧に出るか確認します。

現在のスレッドに即時反映されない場合があります。その場合は Codex Desktop の新規スレッド、またはアプリ再起動で確認します。

### 方法 B: プロジェクト専用 Codex スキルだけをコピーする

まずは `prj3-frontend` だけ導入して、発動確認する方法です。

PowerShell:

```powershell
New-Item -ItemType Directory -Force "C:\Users\tsuts\.codex\skills\prj3-frontend"
Copy-Item `
  -LiteralPath "G:\マイドライブ\AI-Memory\projects\prj3\skills\prj3-frontend\SKILL.md" `
  -Destination "C:\Users\tsuts\.codex\skills\prj3-frontend\SKILL.md" `
  -Force
```

確認プロンプト例:

```text
prj3-frontend スキルを使って、出荷検品アプリの新しい棚卸し画面の設計をしてください。
```

### 方法 C: Codex 用スキルパックとして管理する

複数 PC や複数プロジェクトで使う場合は、以下のようなスキルパックを作成します。

```text
prj3-codex-skills/
  skills/
    prj3-frontend/
      SKILL.md
    security-best-practices/
      SKILL.md
      references/
    refactor/
      SKILL.md
```

当面は方法 A で十分です。運用が固まった段階でスキルパック化します。

## Codex での使い方

Codex では、スキルが一覧に出ている場合、依頼内容に応じて自動適用されます。

明示的に使う場合:

```text
prj3-frontend スキルを使って、在庫管理画面を作成してください。
```

```text
security-best-practices スキルを使って、api/server.js の危険エンドポイントをレビューしてください。
```

```text
refactor スキルを使って、api/server.js の routes 分割計画を作成してください。
```

## Codex 向けに修正した方がよい点

一部の既存文書は Claude Code 前提になっているため、Codex では以下の読み替えが必要です。

```text
Claude Code へのプロンプト
  -> Codex Desktop へのプロンプト

.claude/skills
  -> C:\Users\tsuts\.codex\skills

claude コマンド
  -> Codex Desktop の新規スレッド
```

また、`docs/tech-debt-execution-plan.md` は Claude Code 前提なので、Codex 版を別途作ると運用しやすくなります。

候補:

```text
docs/codex-tech-debt-execution-plan.md
```

## 適用ロードマップ

### Step 1: prj3-frontend のみ導入

- `C:\Users\tsuts\.codex\skills\prj3-frontend\SKILL.md` を作成。
- 新規 Codex スレッドで発動確認。
- UI 画面設計または軽微な HTML 修正で試す。

### Step 2: 技術的負債対応スキルを追加

追加:

```text
security-best-practices
security-threat-model
refactor
playwright
webapp-testing
```

実行対象:

- 危険 API の保護
- `server.js` 分割
- E2E スモークテスト作成

### Step 3: UI/設計支援スキルを追加

追加:

```text
theme-factory
web-design-reviewer
frontend-design
prd
doc-coauthoring
web-artifacts-builder
```

実行対象:

- デザイントークン
- 共通 UI
- 在庫・棚卸し・Grafana 計画の詳細化

### Step 4: Terraform 差分支援を追加

追加:

```text
terraform-azurerm-set-diff-analyzer
```

実行対象:

- Azure Container Apps
- Grafana Cloud 連携
- Container Apps 環境変数追加

### Step 5: Codex 版実行計画を作成

Claude 前提の `tech-debt-execution-plan.md` を Codex 用に置き換えます。

作成候補:

```text
docs/codex-tech-debt-execution-plan.md
```

## 完成条件

```text
prj3-frontend が Codex Desktop のスキルとして認識される。
Codex Desktop で UI 修正時に prj3-frontend を適用できる。
security/refactor/playwright 系スキルを Codex から利用できる。
Claude Code 用手順と Codex Desktop 用手順が docs 上で分離されている。
技術的負債対応を Codex Desktop でも同じ手順で実行できる。
```
