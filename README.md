# ai-workbench

我的 AI 工作台，收录日常使用的 Claude skills 和自动化工具。

## 目录结构

```
obsidian/
  twitter-capture/   # 将 twillot 书签归档到 Obsidian Vault
  capture/           # 记录碎片想法并发散三个方向
browser/
  intranet-reader/   # 用 Chrome CDP 读取内网/需登录页面
```

## obsidian/twitter-capture

将 twillot 导出的 Twitter 书签 JSON 按 folder 分流归档到 Obsidian Vault。
- 普通 folder：调用 Gemini 生成主题相关摘要
- `议题#` 开头的 folder：直接存原文，不调 AI

## obsidian/capture

`/capture` 触发，记录碎片想法到 Obsidian，并发散三个相关方向。

## browser/intranet-reader

通过 Chrome DevTools Protocol 复用本机已登录的 Chrome，读取内网或需要登录的页面内容，输出为 Markdown。
