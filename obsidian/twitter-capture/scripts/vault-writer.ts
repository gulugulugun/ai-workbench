import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const VAULT = path.join(
  os.homedir(),
  'Library/Mobile Documents/iCloud~md~obsidian/Documents'
);

export function getFolderPath(folder: string): string {
  return path.join(VAULT, '00_收集箱', `${folder}.md`);
}

export interface TweetEntry {
  date: string;
  username: string;
  text: string;
  summary: string;
  url: string;
  mediaItems: string[];
  folder: string;
  isTopic: boolean;
}

export async function writeToVault(entry: TweetEntry): Promise<string> {
  const filePath = getFolderPath(entry.folder);
  await mkdir(path.dirname(filePath), { recursive: true });

  const mediaLine = entry.mediaItems.length > 0
    ? '\n' + entry.mediaItems.map(url => `📷 ${url}`).join('\n')
    : '';

  const body = entry.isTopic
    ? `> ${entry.text.replace(/\n/g, '\n> ')}\n\n🔗 ${entry.url}${mediaLine}`
    : `💡 ${entry.summary}\n🔗 ${entry.url}${mediaLine}`;

  const block = `
## ${entry.date} | @${entry.username}
${body}

---
`;

  await appendFile(filePath, block, 'utf-8');
  return filePath;
}
