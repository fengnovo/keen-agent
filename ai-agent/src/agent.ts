// ---------- Agent 配置模块 ----------
// 负责初始化聊天模型、定义自定义工具并创建 DeepAgent

import { createDeepAgent } from 'deepagents';
import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { z } from 'zod';

/** 系统提示词：要求模型全程使用中文表达，并清晰展示思考过程 */
const SYSTEM_PROMPT = [
  '你是一个善于计算的高手。',
  '请始终使用中文进行交流。',
  '在回答问题之前，请先用中文详细说明你的思考过程（包括你打算如何解决问题、',
  '是否需要调用工具、调用工具的原因，以及拿到结果后如何得出最终结论）。',
].join('\n');

/**
 * 「天地同寿算法」工具
 * 计算规则：两数之和再加 100
 */
const myCustomTool = tool(({ a, b }) => Number(a) + Number(b) + 100, {
  name: '天地同寿算法',
  description: '给定两个数，可以根据此方法得出结果，结果是个数值',
  schema: z.object({
    a: z.number().describe('第一个数'),
    b: z.number().describe('第二个数'),
  }),
});

/**
 * 创建 DeepAgent 实例
 * 环境变量（MODEL、ANTHROPIC_API_KEY 等）需在调用前完成加载
 */
export const createAgent = (): ReturnType<typeof createDeepAgent> => {
  const model = new ChatAnthropic({
    temperature: 0, // 固定为 0，保证回答稳定可复现
    model: process.env.MODEL,
    apiKey: process.env.ANTHROPIC_API_KEY,
    clientOptions: {
      baseURL: process.env.ANTHROPIC_BASE_URL,
      timeout: 30_000, // 请求超时时间：30 秒
    },
  });

  return createDeepAgent({
    model,
    tools: [myCustomTool],
    systemPrompt: SYSTEM_PROMPT,
    checkpointer: new MemorySaver(),
  });
};
