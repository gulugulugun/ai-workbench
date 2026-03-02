---
name: intranet-reader
description: 使用 Chrome CDP 读取需要登录或内网才能访问的页面，提取正文内容并输出为 Markdown。当用户提到要读取、抓取、获取内网页面、公司内部系统、需要 VPN 才能访问的网址、或者任何需要登录才能看到的网页内容时，必须使用这个 skill。触发词包括：读取内网、抓取页面、fetch 内部链接、看看这个内网地址、帮我读一下这个 URL 等。
---

## 工作原理

通过 **Chrome DevTools Protocol (CDP)** 启动本机已登录的 Chrome，复用现有 Cookie 和登录状态，直接访问内网页面并提取内容——完全不需要重新登录。

脚本位置: `${SKILL_DIR}/scripts/intranet-reader.ts`

---

## 执行流程

### Step 0: 检查已保存配置

```bash
cat ~/.intranet-reader/config.json 2>/dev/null || echo "NO_CONFIG"
```

若存在配置（含常用 selector 等），在 Step 1 后询问是否直接使用。

### Step 1: 收集参数

从用户消息中提取 URL。若消息中没有 URL，使用 `question()` 询问：

```
请输入要读取的内网页面 URL（支持多个，空格或逗号分隔）：
```

若用户提到页面有特定的内容区域（如"只读取文章部分"），询问 CSS 选择器，否则跳过（脚本会自动检测）。

### Step 2: 执行脚本

```bash
export PATH="$HOME/.bun/bin:$PATH"

bun run "${SKILL_DIR}/scripts/intranet-reader.ts" \
  "<url1>" ["<url2>" ...] \
  [--selector "<css-selector>"] \
  [--wait <毫秒>] \
  [--output <输出目录>]
```

**参数说明:**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<url>` | 目标 URL，可多个 | 必填 |
| `--selector` | CSS 选择器指定内容区域 | 自动检测 |
| `--wait` | 等待动态内容加载（ms） | 2000 |
| `--output` | 保存 .md 文件的目录 | 仅输出到 stdout |
| `--profile` | Chrome 用户数据目录 | `~/.local/share/intranet-reader-profile` |

### Step 3: 首次使用 — 登录引导

**首次运行**时，Chrome 会弹出窗口并打开 `about:blank`（使用独立 profile，不影响日常浏览器）。

若页面需要登录，告知用户：
> Chrome 窗口已打开，请手动导航到内网并完成登录。登录状态会自动保存，下次直接使用。

登录完成后，重新运行脚本即可。

### Step 4: 展示结果

脚本将 Markdown 内容输出到 stdout。根据内容长度决定展示方式：

- **内容较短**（< 2000 字）：直接展示全文
- **内容较长**：展示标题 + 摘要，并提示保存路径

若用户有后续问题（如"总结一下"、"找一下 XXX 信息"），直接基于读取到的内容回答。

---

## 常见场景示例

**读取单个页面:**
```bash
bun run intranet-reader.ts "http://wiki.internal/page/12345"
```

**读取多个页面并保存:**
```bash
bun run intranet-reader.ts \
  "http://confluence/pages/viewpage.action?pageId=111" \
  "http://confluence/pages/viewpage.action?pageId=222" \
  --output ~/Downloads/wiki-export
```

**针对特定系统的选择器:**
- Confluence: `--selector "#main-content"`
- 自建 Wiki: `--selector ".wiki-body, .markdown-body"`
- 一般后台: `--selector "main, .content, article"`

**SPA 单页应用（需要更长等待）:**
```bash
bun run intranet-reader.ts "http://intranet/app/report" --wait 5000
```

---

## 环境要求

- Google Chrome 或 Chromium 浏览器（已安装）
- `bun` 运行时（如未安装，提示用户运行 `curl -fsSL https://bun.sh/install | bash`）
- 内网访问权限（VPN 已连接，或在内网环境中）

## 故障排除

**"Chrome not found"**
→ 设置环境变量: `export INTRANET_CHROME_PATH="/path/to/chrome"`

**页面加载但内容为空**
→ 可能是 SPA，增加等待时间: `--wait 5000`
→ 或手动指定选择器: `--selector ".your-content-class"`

**需要登录**
→ Chrome 窗口会打开，手动导航登录，登录态会保存到 profile 目录

**内容乱码或格式错乱**
→ 尝试指定更精确的 CSS 选择器来定位主内容区域
