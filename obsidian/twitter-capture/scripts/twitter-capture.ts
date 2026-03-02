import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { createAIClient } from './ai-client.js';
import { summarizeTweet } from './classifier.js';
import { writeToVault, getFolderPath } from './vault-writer.js';

// CLI Args: bun run twitter-capture.ts <json文件路径> [--ai-provider=gemini|openai]
const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith('--'));
const aiProvider = args.find(a => a.startsWith('--ai-provider='))?.split('=')[1] as 'gemini' | 'openai' | undefined;

if (!jsonPath) {
  console.error('用法: bun run twitter-capture.ts <json文件路径> [--ai-provider=gemini|openai]');
  process.exit(1);
}

interface BookmarkRecord {
  full_text: string;
  screen_name: string;
  url: string;
  created_at: string;
  media_items: string[];
  is_long_text: boolean;
  has_video: boolean;
  is_thread: boolean | null;
  folder: string;
}

async function main() {
  // 1. 读取 JSON
  const raw = await readFile(jsonPath!, 'utf-8');
  const records: BookmarkRecord[] = JSON.parse(raw);
  console.log(`📂 读取到 ${records.length} 条书签`);

  // 2. 初始化 AI（议题类全部跳过 AI，仅在有非议题条目时需要）
  const hasNonTopic = records.some(r => !r.folder?.startsWith('议题#'));
  const ai = hasNonTopic ? createAIClient({ provider: aiProvider }) : null;
  if (hasNonTopic && !ai) throw new Error('未找到 AI API Key，请设置 GEMINI_API_KEY 或 OPENAI_API_KEY');

  // 3. 逐条处理并写入
  const stats: Record<string, number> = {};
  const errors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    process.stdout.write(`\r📝 处理中 ${i + 1}/${records.length}...`);

    try {
      const date = r.created_at.slice(0, 10);
      const folder = r.folder || '待分类';
      const isTopic = folder.startsWith('议题#');

      let summary = '';
      if (!isTopic && ai) {
        const contextText = [
          r.full_text,
          r.is_long_text ? '[长文]' : '',
          r.has_video ? '[含视频]' : '',
          r.is_thread ? '[Thread]' : '',
        ].filter(Boolean).join('\n');
        ({ summary } = await summarizeTweet(contextText, ai, r.media_items ?? [], folder));
      }

      await writeToVault({
        date,
        username: r.screen_name,
        text: r.full_text,
        summary,
        url: r.url,
        mediaItems: r.media_items ?? [],
        folder,
        isTopic,
      });

      stats[folder] = (stats[folder] ?? 0) + 1;
    } catch (e) {
      errors.push(`${r.url}: ${e}`);
    }
  }

  console.log('\n\n📊 写入完成：');
  for (const [folder, count] of Object.entries(stats)) {
    console.log(`  ${folder}: ${count} 条 → ${getFolderPath(folder)}`);
  }

  if (errors.length > 0) {
    console.log(`\n⚠️ 失败 ${errors.length} 条：`);
    errors.forEach(e => console.log(`  ${e}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
