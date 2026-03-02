# Twitter Capture

将 twillot 导出的 Twitter 书签 JSON 按类型分流归档到 Obsidian Vault。

## 触发方式

用户说 `/twitter-capture` 时触发。

## 交互流程

### Step 0: 检查已保存配置

```bash
cat ~/.twitter-capture/config.json 2>/dev/null || echo "NO_CONFIG"
```

如有配置，用 question() 工具询问是否复用上次配置；否则进入 Step 1。

### Step 1: 收集参数

用 question() 工具询问以下参数：

**Q1：JSON 文件路径**
- 默认提示：`~/Downloads/twillot-bookmark.json`
- 如有上次配置，在选项中展示上次路径

**Q2：AI 服务商**
- 自动检测（推荐）
- Gemini
- OpenAI 兼容

### Step 2: 执行脚本

```bash
export GEMINI_API_KEY="..."   # 如需要

SKILL_DIR=/Users/xixi/.claude/plugins/cache/local-skills/twitter-capture/1.0.0/skills/twitter-capture

bun run $SKILL_DIR/scripts/twitter-capture.ts \
  <json文件路径> \
  [--ai-provider=gemini|openai]
```

参数映射：
- 自动检测 → 不传 --ai-provider
- Gemini → --ai-provider=gemini
- OpenAI 兼容 → --ai-provider=openai

### Step 3: 保存配置

```bash
mkdir -p ~/.twitter-capture
```

将本次使用的参数保存到 `~/.twitter-capture/config.json`：

```json
{
  "jsonPath": "<文件路径>",
  "aiProvider": "<provider或auto>",
  "lastUsed": "<ISO时间戳>"
}
```

### Step 4: 展示结果

展示各类别写入条数和对应文件路径。

## 写入目标

写入路径由 JSON 中的 `folder` 字段决定：`00_收集箱/<folder>.md`

## 写入逻辑

根据 `folder` 是否以 `议题#` 开头，分两种处理模式：

**普通 folder**（如"赚钱思路"）：调用 AI，从该主题视角生成一句话摘要（含图片分析）

```markdown
## 2026-03-01 | @screen_name
💡 一句话摘要（结合主题视角）
🔗 原链接
📷 图片链接（如有）

---
```

**议题 folder**（如"议题#saas和ai"）：不调 AI，直接存原文

```markdown
## 2026-03-01 | @screen_name
> 推文原文（多行自动缩进）

🔗 原链接
📷 图片链接（如有）

---
```

## 环境要求

- bun 运行时
- GEMINI_API_KEY 或 OPENAI_API_KEY（普通 folder 必须；全为议题则不需要）
- twillot 导出的 JSON 文件（支持 twillot-bookmark.json 格式）
