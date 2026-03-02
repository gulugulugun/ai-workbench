# ai-workbench

我的 AI 工作台，收录日常使用的 Claude skills 和自动化工具。

## 目录结构

```
obsidian/
  twitter-capture/   # 将 twillot 书签归档到 Obsidian Vault
```

## obsidian/twitter-capture

将 twillot 导出的 Twitter 书签 JSON 按 folder 分流归档到 Obsidian Vault。

- 普通 folder：调用 Gemini 生成主题相关摘要
- `议题#` 开头的 folder：直接存原文，不调 AI

详见 [obsidian/twitter-capture/SKILL.md](obsidian/twitter-capture/SKILL.md)
