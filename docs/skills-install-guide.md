# 公開スキル導入手順書 (Claude Code / WSL2)

docs/skills-adoption-plan.md で採用した公開スキルを、WSL2 上の実装リポジトリ (~/grafana-setup-azure) の `.claude/skills/` へ導入する手順です。後半にプラグイン形式での配布手順も記載します。

## 前提

- WSL2 (Ubuntu) 上に git がインストール済み
- Claude Code がインストール済み (`claude --version` で確認)
- 実装リポジトリ: `~/grafana-setup-azure` (パスが異なる場合は読み替え)

## 導入対象スキル

| 出典リポジトリ | スキル名 |
|---|---|
| anthropics/skills | frontend-design, theme-factory, webapp-testing, doc-coauthoring, web-artifacts-builder, skill-creator |
| openai/skills | playwright, security-best-practices, security-threat-model |
| github/awesome-copilot | web-design-reviewer, refactor, terraform-azurerm-set-diff-analyzer, appinsights-instrumentation, azure-resource-visualizer, prd |

## Step 1: 3 リポジトリを clone

作業用ディレクトリに clone します(プロジェクト内には置かない)。

```bash
mkdir -p ~/agent-skills-src && cd ~/agent-skills-src

git clone --depth 1 https://github.com/anthropics/skills.git anthropic-skills
git clone --depth 1 https://github.com/openai/skills.git openai-skills
git clone --depth 1 https://github.com/github/awesome-copilot.git awesome-copilot
```

`--depth 1` は履歴を取得しない浅い clone で、サイズと時間を節約します。

各リポジトリ内のスキル配置(コピー元のパス)は以下の通りです。

```text
anthropic-skills/skills/<skill-name>/
openai-skills/skills/.curated/<skill-name>/
awesome-copilot/skills/<skill-name>/
```

## Step 2: プロジェクトの .claude/skills/ へコピー

スキルは「SKILL.md を含むディレクトリごと」コピーします(scripts/ や references/ が同梱されているスキルがあるため、SKILL.md 単体のコピーは不可)。

```bash
PROJ=~/grafana-setup-azure
SRC=~/agent-skills-src
mkdir -p "$PROJ/.claude/skills"

# anthropic (6件)
for s in frontend-design theme-factory webapp-testing doc-coauthoring web-artifacts-builder skill-creator; do
  cp -r "$SRC/anthropic-skills/skills/$s" "$PROJ/.claude/skills/"
done

# openai (3件)
for s in playwright security-best-practices security-threat-model; do
  cp -r "$SRC/openai-skills/skills/.curated/$s" "$PROJ/.claude/skills/"
done

# awesome-copilot (6件)
for s in web-design-reviewer refactor terraform-azurerm-set-diff-analyzer appinsights-instrumentation azure-resource-visualizer prd; do
  cp -r "$SRC/awesome-copilot/skills/$s" "$PROJ/.claude/skills/"
done
```

注意: リポジトリ側のディレクトリ名は変わることがあります。コピー前に存在確認をすると安全です。

```bash
ls "$SRC/anthropic-skills/skills/" "$SRC/openai-skills/skills/.curated/" "$SRC/awesome-copilot/skills/"
```

## Step 3: 自作スキル (prj3-frontend) を配置

Google Drive 側の prj3 に作成済みの SKILL.md をコピーします。

```bash
# Drive のマウントパスは環境に合わせる (例: /mnt/g/マイドライブ/...)
DRIVE="/mnt/g/マイドライブ/AI-Memory/projects/prj3"
mkdir -p "$PROJ/.claude/skills/prj3-frontend"
cp "$DRIVE/skills/prj3-frontend/SKILL.md" "$PROJ/.claude/skills/prj3-frontend/"
```

## Step 4: 配置の検証

```bash
# 全スキルに SKILL.md があるか確認
find "$PROJ/.claude/skills" -maxdepth 2 -name SKILL.md | sort

# frontmatter (name / description) の確認
head -5 "$PROJ/.claude/skills/frontend-design/SKILL.md"
```

16 件 (公開 15 + prj3-frontend) の SKILL.md が表示されれば OK です。

## Step 5: Claude Code での動作確認

```bash
cd "$PROJ"
claude
```

起動後、以下で発動を確認します。

```text
> 検品一覧画面に絞り込みを追加したい      → prj3-frontend が発動するか
> この API のセキュリティレビューをして    → security-best-practices が発動するか
```

スキルは description に基づいて自動発動します。発動しない場合は明示指定も可能です(「prj3-frontend スキルを使って〜」)。

## Step 6: description のカスタマイズ(推奨)

公開スキルの description は汎用的なため、プロジェクト文脈の語を追記すると発動精度が上がります。例(playwright):

```yaml
# 変更前
description: Browser automation with Playwright CLI ...
# 変更後 (末尾に追記)
description: Browser automation with Playwright CLI ... 出荷検品アプリの検品フロー・
  ピッキング・一覧画面の E2E テストやスモークテストを作成・実行するときにも必ず使う。
```

## Step 7: git 管理

`.claude/skills/` はチーム共有資産としてコミットします。

```bash
cd "$PROJ"
git add .claude/skills
git commit -m "chore: add agent skills (15 public + prj3-frontend)"
```

## 更新運用(四半期ごと)

```bash
cd ~/agent-skills-src
for d in anthropic-skills openai-skills awesome-copilot; do (cd $d && git pull); done
# 差分を確認してから Step 2 を再実行 (ローカル改変した description に注意)
diff -r "$SRC/anthropic-skills/skills/frontend-design" "$PROJ/.claude/skills/frontend-design"
```

Step 6 で description を改変している場合、単純上書きすると消えるため、diff 確認 → 手動マージとします。

---

# プラグイン形式での配布(オプション)

複数リポジトリ・複数メンバーで同じスキルセットを使う場合、プラグインにまとめると `/plugin install` 一発で導入できます。

## プラグインの構造

```text
prj3-agent-pack/
├── .claude-plugin/
│   └── plugin.json          # マニフェスト
└── skills/                  # スキルはプラグイン直下 (※ .claude-plugin の中ではない)
    ├── prj3-frontend/SKILL.md
    ├── frontend-design/...
    ├── security-best-practices/...
    └── ...
```

plugin.json:

```json
{
  "name": "prj3-agent-pack",
  "description": "出荷検品アプリ開発用スキルセット (フロントエンド規約・セキュリティ・テスト・IaC)",
  "version": "1.0.0",
  "author": { "name": "Yoshihiro" }
}
```

## 作成手順

```bash
mkdir -p ~/prj3-agent-pack/.claude-plugin ~/prj3-agent-pack/skills
# plugin.json を上記内容で作成
cp -r "$PROJ/.claude/skills/"* ~/prj3-agent-pack/skills/
cd ~/prj3-agent-pack && git init && git add -A && git commit -m "init"
# GitHub に push (プライベートリポジトリ可)
```

## マーケットプレイス経由の配布

配布用リポジトリに `.claude-plugin/marketplace.json` を置きます。

```json
{
  "name": "prj3-marketplace",
  "owner": { "name": "Yoshihiro" },
  "plugins": [
    { "name": "prj3-agent-pack", "source": "./", "description": "出荷検品アプリ開発用スキルセット" }
  ]
}
```

利用側(各メンバーの Claude Code):

```text
/plugin marketplace add <GitHubユーザー名>/prj3-agent-pack
/plugin install prj3-agent-pack@prj3-marketplace
```

## 使い分けの目安

```text
.claude/skills/ 直置き : リポジトリが 1 つ (grafana-setup-azure) で完結する現状はこちらで十分
プラグイン形式          : 複数リポジトリ・複数メンバーに同一セットを配る段階になったら移行
```

## 参考

- Agent Skills: https://docs.claude.com/ja/docs/claude-code/skills
- プラグイン: https://docs.claude.com/ja/docs/claude-code/plugins
- 採用スキルの選定理由: docs/skills-adoption-plan.md
