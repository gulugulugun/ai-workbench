#!/usr/bin/env bun

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const VAULT = join(
  process.env.HOME!,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents"
);
const INBOX_FILE = join(VAULT, "00_收集箱/想法.md");
const MATERIAL_DIR = join(VAULT, "20_素材库");
const TOOL_DIR = join(VAULT, "10_工具库/已验证");

const idea = process.argv.slice(2).join(" ").trim();

if (!idea) {
  console.error("用法: capture.ts <想法内容>");
  process.exit(1);
}

// 写入收集箱
const now = new Date();
const timestamp = now
  .toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  .replace(/\//g, "-");

const entry = `\n## ${timestamp}\n${idea}\n#待发散\n`;

const existing = existsSync(INBOX_FILE)
  ? readFileSync(INBOX_FILE, "utf-8")
  : "# 想法收集箱\n";
writeFileSync(INBOX_FILE, existing + entry, "utf-8");

console.log(`[capture] 已记录: ${timestamp}`);

// 检索素材库和工具库，找关联内容
const related: string[] = [];

function searchDir(dir: string, label: string) {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir, { recursive: true }) as string[];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const filePath = join(dir, f);
    try {
      const content = readFileSync(filePath, "utf-8");
      const keywords = idea.split(/\s+/).filter((w) => w.length > 1);
      const matched = keywords.some((kw) =>
        content.toLowerCase().includes(kw.toLowerCase())
      );
      if (matched) {
        const title = f.replace(/\.md$/, "").replace(/\\/g, "/");
        related.push(`[${label}] ${title}`);
      }
    } catch {}
  }
}

searchDir(MATERIAL_DIR, "素材");
searchDir(TOOL_DIR, "工具");

// 输出结果供 SKILL.md 使用
console.log("RELATED:" + JSON.stringify(related));
