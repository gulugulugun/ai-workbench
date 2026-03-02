/**
 * intranet-reader.ts
 * 使用 Chrome CDP 读取内网页面内容，转换为 Markdown 输出
 *
 * Usage:
 *   bun run intranet-reader.ts <url1> [url2 ...] [options]
 *
 * Options:
 *   --selector <css>   指定内容区域的 CSS 选择器（默认自动检测）
 *   --wait <ms>        等待动态内容加载的时间，毫秒（默认 2000）
 *   --output <dir>     输出目录，每个 URL 保存一个 .md 文件
 *   --profile <dir>    Chrome 用户数据目录（默认复用已保存的登录态）
 *   --stdout           强制输出到 stdout（默认行为）
 *   --help             显示帮助
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  CdpConnection,
  CHROME_CANDIDATES,
  findChromeExecutable,
  getDefaultProfileDir,
  getFreePort,
  sleep,
  waitForChromeDebugPort,
} from './cdp-utils.js';

// HTML → Markdown 转换器（注入到页面中执行）
const HTML_TO_MD_SCRIPT = `
(function(rootEl) {
  if (!rootEl) return '';

  const clone = rootEl.cloneNode(true);

  // 移除干扰元素
  const REMOVE_TAGS = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer',
    'header', 'aside', 'form', '.nav', '.navigation', '.sidebar', '.footer',
    '.header', '.menu', '.ad', '.advertisement', '.cookie-banner'];
  REMOVE_TAGS.forEach(sel => {
    try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
  });

  function walk(node) {
    if (node.nodeType === 3) {
      // 文本节点：保留有意义的空白
      return node.textContent;
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    const children = () => Array.from(node.childNodes).map(walk).join('');

    // 标题
    const headings = { h1: '# ', h2: '## ', h3: '### ', h4: '#### ', h5: '##### ', h6: '###### ' };
    if (headings[tag]) return '\\n\\n' + headings[tag] + children().trim() + '\\n';

    // 段落 / 换行
    if (tag === 'p') return '\\n\\n' + children().trim() + '\\n';
    if (tag === 'br') return '\\n';
    if (tag === 'hr') return '\\n\\n---\\n\\n';
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'main') {
      const inner = children();
      // 只有在内含块级内容时才加换行
      return inner.includes('\\n') ? '\\n' + inner + '\\n' : inner;
    }

    // 行内格式
    if (tag === 'strong' || tag === 'b') {
      const t = children().trim();
      return t ? '**' + t + '**' : '';
    }
    if (tag === 'em' || tag === 'i') {
      const t = children().trim();
      return t ? '*' + t + '*' : '';
    }
    if (tag === 's' || tag === 'del' || tag === 'strike') {
      return '~~' + children() + '~~';
    }

    // 代码
    if (tag === 'code') {
      const parent = node.parentNode?.tagName?.toLowerCase();
      if (parent === 'pre') return node.textContent || '';
      return '\`' + (node.textContent || '').trim() + '\`';
    }
    if (tag === 'pre') {
      const codeEl = node.querySelector('code');
      const lang = codeEl?.className?.match(/language-(\\w+)/)?.[1] || '';
      const content = (codeEl?.textContent || node.textContent || '').trim();
      return '\\n\\n\`\`\`' + lang + '\\n' + content + '\\n\`\`\`\\n';
    }

    // 链接 / 图片
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const text = children().trim();
      if (!text) return '';
      if (!href || href.startsWith('javascript') || href === '#') return text;
      return '[' + text + '](' + href + ')';
    }
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      if (!src) return '';
      return '![' + alt + '](' + src + ')';
    }

    // 列表
    if (tag === 'ul') {
      const items = Array.from(node.querySelectorAll(':scope > li'))
        .map(li => '- ' + Array.from(li.childNodes).map(walk).join('').trim())
        .filter(s => s.length > 2);
      return items.length ? '\\n' + items.join('\\n') + '\\n' : '';
    }
    if (tag === 'ol') {
      const items = Array.from(node.querySelectorAll(':scope > li'))
        .map((li, i) => (i + 1) + '. ' + Array.from(li.childNodes).map(walk).join('').trim())
        .filter(s => s.length > 3);
      return items.length ? '\\n' + items.join('\\n') + '\\n' : '';
    }
    if (tag === 'li') return children();

    // 引用
    if (tag === 'blockquote') {
      return '\\n' + children().split('\\n').map(l => '> ' + l).join('\\n') + '\\n';
    }

    // 表格
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (!rows.length) return '';
      const toRow = tr => Array.from(tr.querySelectorAll('th, td'))
        .map(c => c.textContent?.trim().replace(/\\|/g, '\\\\|') || '')
        .join(' | ');
      const colCount = rows[0].querySelectorAll('th, td').length;
      if (!colCount) return '';
      const header = '| ' + toRow(rows[0]) + ' |';
      const divider = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
      const body = rows.slice(1).map(r => '| ' + toRow(r) + ' |').join('\\n');
      return '\\n\\n' + header + '\\n' + divider + (body ? '\\n' + body : '') + '\\n';
    }

    // 跳过这些标签
    if (['script', 'style', 'noscript', 'iframe', 'button', 'input', 'select', 'textarea'].includes(tag)) return '';

    return children();
  }

  return walk(clone)
    .replace(/\\n{3,}/g, '\\n\\n')
    .replace(/[ \\t]+$/gm, '')
    .trim();
})
`;

interface PageResult {
  url: string;
  title: string;
  markdown: string;
  error?: string;
}

interface ReadOptions {
  urls: string[];
  selector?: string;
  waitMs: number;
  outputDir?: string;
  profileDir: string;
}

async function readPages(options: ReadOptions): Promise<PageResult[]> {
  const chromePath = findChromeExecutable(CHROME_CANDIDATES);
  if (!chromePath) {
    throw new Error(
      'Chrome not found. Install Google Chrome or set INTRANET_CHROME_PATH environment variable.',
    );
  }

  await mkdir(options.profileDir, { recursive: true });

  const port = await getFreePort();
  console.error(`[intranet-reader] Launching Chrome (profile: ${options.profileDir})`);

  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${options.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp: CdpConnection | null = null;

  try {
    const wsUrl = await waitForChromeDebugPort(port, 30_000);
    cdp = await CdpConnection.connect(wsUrl, 30_000, { defaultTimeoutMs: 20_000 });

    // 找到或创建页面
    const targets = await cdp.send<{
      targetInfos: Array<{ targetId: string; url: string; type: string }>;
    }>('Target.getTargets');

    let targetId: string;
    const existingPage = targets.targetInfos.find((t) => t.type === 'page');
    if (existingPage) {
      targetId = existingPage.targetId;
    } else {
      const created = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      targetId = created.targetId;
    }

    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    });

    await cdp.send('Page.enable', {}, { sessionId });
    await cdp.send('Runtime.enable', {}, { sessionId });

    const results: PageResult[] = [];

    for (const url of options.urls) {
      console.error(`[intranet-reader] Fetching: ${url}`);
      try {
        const result = await readOnePage(cdp, sessionId, url, options);
        results.push(result);

        // 保存到文件（如果指定了输出目录）
        if (options.outputDir) {
          await mkdir(options.outputDir, { recursive: true });
          const filename = urlToFilename(url) + '.md';
          const filepath = path.join(options.outputDir, filename);
          await writeFile(filepath, formatOutput(result));
          console.error(`[intranet-reader] Saved: ${filepath}`);
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[intranet-reader] Error fetching ${url}: ${error}`);
        results.push({ url, title: '', markdown: '', error });
      }
    }

    return results;
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close', {}, { timeoutMs: 3_000 }); } catch {}
      cdp.close();
    }
    setTimeout(() => {
      if (!chrome.killed) try { chrome.kill('SIGKILL'); } catch {}
    }, 2_000).unref?.();
    try { chrome.kill('SIGTERM'); } catch {}
  }
}

async function readOnePage(
  cdp: CdpConnection,
  sessionId: string,
  url: string,
  options: { selector?: string; waitMs: number },
): Promise<PageResult> {
  // 导航到页面
  await cdp.send('Page.navigate', { url }, { sessionId });

  // 等待页面加载
  await waitForLoad(cdp, sessionId, options.waitMs);

  // 提取内容
  const extractResult = await cdp.send<{ result: { value: { title: string; markdown: string; detectedSelector: string } } }>(
    'Runtime.evaluate',
    {
      expression: `
        (() => {
          const title = document.title || document.querySelector('h1')?.textContent?.trim() || '';

          // 按优先级查找主内容区域
          const CONTENT_SELECTORS = ${JSON.stringify(
            options.selector
              ? [options.selector]
              : [
                  'main',
                  '[role="main"]',
                  'article',
                  '.main-content',
                  '.content-area',
                  '.page-content',
                  '#main-content',
                  '#content',
                  '.container .content',
                  '.wrapper .content',
                  '.post-content',
                  '.article-content',
                  '.entry-content',
                  '.markdown-body',
                  '.wiki-content',
                  '.confluence-content',
                ]
          )};

          let contentEl = null;
          let detectedSelector = 'body';
          for (const sel of CONTENT_SELECTORS) {
            const el = document.querySelector(sel);
            if (el && el.textContent?.trim().length > 100) {
              contentEl = el;
              detectedSelector = sel;
              break;
            }
          }
          if (!contentEl) contentEl = document.body;

          const toMd = ${HTML_TO_MD_SCRIPT};
          const markdown = toMd(contentEl);

          return { title, markdown, detectedSelector };
        })()
      `,
      returnByValue: true,
    },
    { sessionId },
  );

  const { title, markdown, detectedSelector } = extractResult.result.value;
  console.error(`[intranet-reader] Extracted from selector: ${detectedSelector}, length: ${markdown.length} chars`);

  return { url, title, markdown };
}

async function waitForLoad(cdp: CdpConnection, sessionId: string, waitMs: number): Promise<void> {
  // 先等待 DOMContentLoaded
  const loadPromise = cdp
    .send('Page.domContentEventFired', {}, { sessionId, timeoutMs: 15_000 })
    .catch(() => {}); // 有些页面已经加载完成，事件不会再触发

  await Promise.race([loadPromise, sleep(3000)]);

  // 再额外等待动态内容
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function urlToFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const base = (parsed.hostname + parsed.pathname)
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return base.slice(0, 100);
  } catch {
    return 'page_' + Date.now();
  }
}

function formatOutput(result: PageResult): string {
  if (result.error) {
    return `# Error\n\nFailed to read: ${result.url}\n\nError: ${result.error}\n`;
  }

  const parts: string[] = [];

  // 元数据头部
  parts.push(`---`);
  parts.push(`url: ${result.url}`);
  parts.push(`title: ${result.title}`);
  parts.push(`fetched: ${new Date().toISOString()}`);
  parts.push(`---`);
  parts.push('');

  if (result.title) {
    parts.push(`# ${result.title}`);
    parts.push('');
  }

  parts.push(result.markdown);

  return parts.join('\n');
}

function printUsage(): never {
  console.log(`
intranet-reader — 使用 Chrome CDP 读取内网页面，输出 Markdown

用法:
  bun run intranet-reader.ts <url1> [url2 ...] [选项]

选项:
  --selector <css>   指定内容区域的 CSS 选择器（默认自动检测）
  --wait <ms>        等待动态内容加载的毫秒数（默认 2000）
  --output <dir>     将每个页面保存为 .md 文件到指定目录
  --profile <dir>    Chrome 用户数据目录（默认: ~/.local/share/intranet-reader-profile）
  --help             显示此帮助

环境变量:
  INTRANET_CHROME_PATH   自定义 Chrome 可执行文件路径

示例:
  # 读取单个页面
  bun run intranet-reader.ts https://internal.company.com/wiki/page

  # 读取多个页面并保存到文件
  bun run intranet-reader.ts https://intranet/page1 https://intranet/page2 --output ./docs

  # 指定内容选择器（针对特定系统优化）
  bun run intranet-reader.ts https://intranet/page --selector ".wiki-content"

  # 等待更长时间（适合 SPA 单页应用）
  bun run intranet-reader.ts https://intranet/app --wait 5000
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
  }

  const urls: string[] = [];
  let selector: string | undefined;
  let waitMs = 2000;
  let outputDir: string | undefined;
  let profileDir = getDefaultProfileDir();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--selector' && args[i + 1]) {
      selector = args[++i]!;
    } else if (arg === '--wait' && args[i + 1]) {
      waitMs = parseInt(args[++i]!, 10);
    } else if (arg === '--output' && args[i + 1]) {
      outputDir = args[++i]!;
    } else if (arg === '--profile' && args[i + 1]) {
      profileDir = args[++i]!;
    } else if (!arg.startsWith('--')) {
      // 验证 URL
      try {
        new URL(arg);
        urls.push(arg);
      } catch {
        console.error(`[intranet-reader] Warning: "${arg}" is not a valid URL, skipping.`);
      }
    }
  }

  if (urls.length === 0) {
    console.error('Error: No valid URLs provided.');
    printUsage();
  }

  console.error(`[intranet-reader] Reading ${urls.length} page(s)...`);

  const results = await readPages({ urls, selector, waitMs, outputDir, profileDir });

  // 输出到 stdout 供 Claude 读取
  for (const result of results) {
    if (results.length > 1) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`URL: ${result.url}`);
      console.log('='.repeat(60));
    }
    console.log(formatOutput(result));
  }

  console.error(`[intranet-reader] Done. ${results.filter(r => !r.error).length}/${results.length} pages read successfully.`);
}

if (import.meta.main) {
  await main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
