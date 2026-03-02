import type { AIClient } from './ai-client.js';

export interface SummarizeResult {
  summary: string;
}

const SUMMARY_PROMPT = (text: string, folder: string) => `
你是一个内容摘要助手。根据以下推文内容（可能附带图片），从「${folder}」的视角，用一句话概括对读者最有价值的核心要点。

推文内容：
${text}

要求：
- 中文输出
- 50字以内
- 聚焦与「${folder}」相关的信息
- 直接返回摘要文字，不要加任何前缀或标点包裹

只返回摘要文字，不要其他内容。
`.trim();

export async function summarizeTweet(
  text: string,
  ai: AIClient,
  imageUrls: string[] = [],
  folder: string = ''
): Promise<SummarizeResult> {
  try {
    const prompt = SUMMARY_PROMPT(text, folder);
    const summary = imageUrls.length > 0 && ai.generateWithImages
      ? await ai.generateWithImages(prompt, imageUrls)
      : await ai.generate(prompt);
    return { summary: summary.trim() };
  } catch {
    return { summary: '' };
  }
}
