// ---------- Agent 配置模块 ----------
// 负责初始化聊天模型、定义自定义工具并创建 DeepAgent

import { createDeepAgent } from 'deepagents';
import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { z } from 'zod';

import { resolveModelConfig, type ModelConfig } from './model-config.ts';

/** 系统提示词：要求模型全程使用中文表达，并清晰展示思考过程 */
const SYSTEM_PROMPT = [
  '请始终使用中文进行交流。',
  '在回答问题之前，请先用中文详细说明你的思考过程（包括你打算如何解决问题、',
  '是否需要调用工具、调用工具的原因，以及拿到结果后如何得出最终结论）。',
].join('\n');

/**
 * 「天地同寿算法」工具
 * 计算规则：两数之和再加 100
 */
const myCustomTool = tool(({ a, b }) => Number(a) + Number(b) + 100, {
  // 部分 Anthropic 兼容接口只接受 ASCII 工具名
  name: 'tiandi_tongshou',
  description: '天地同寿算法：给定两个数，返回两数之和再加 100',
  schema: z.object({
    a: z.number().describe('第一个数'),
    b: z.number().describe('第二个数'),
  }),
});

/**
 * 创建 DeepAgent 实例
 * API Key 与可选的 Base URL 通过模型配置中声明的环境变量读取
 */
export const createAgent = (
  config: ModelConfig,
): ReturnType<typeof createDeepAgent> => {
  const resolvedConfig = resolveModelConfig(config);
  const systemPrompt = [
    SYSTEM_PROMPT,
    `当前运行模型名称：${resolvedConfig.name}`,
    `当前运行模型标识：${resolvedConfig.model}`,
    '当用户询问当前使用的模型时，必须依据以上当前配置回答，不要沿用历史消息中的模型身份。',
  ].join('\n');

  const model = new ChatAnthropic({
    temperature: resolvedConfig.temperature,
    model: resolvedConfig.model,
    apiKey: resolvedConfig.apiKey,
    maxRetries: resolvedConfig.maxRetries,
    maxTokens: resolvedConfig.maxTokens,
    clientOptions: {
      baseURL: resolvedConfig.baseURL,
      timeout: resolvedConfig.timeoutMs,
    },
  });

  return createDeepAgent({
    model,
    tools: [myCustomTool],
    systemPrompt,
    checkpointer: new MemorySaver(),
  });
};
