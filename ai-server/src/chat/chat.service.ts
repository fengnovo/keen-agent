/**
 * Web 聊天编排服务。
 * 负责把页面请求转换为 ai-agent 输入，并把 Agent 事件拆成前端可消费的文本块。
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createAgent } from '@keen-agent/ai-agent/agent';
import type { ModelConfig } from '@keen-agent/ai-agent/model-config';
import { z } from 'zod';

import {
  ConversationsService,
  type ChatConversation,
} from '../conversations/conversations.service.js';
import { ModelsService } from '../models/models.service.js';

/** 页面只需传会话、可选模型和消息；服务端只采纳最后一条用户消息。 */
const chatRequestSchema = z.object({
  conversationId: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.unknown(),
      }),
    )
    .min(1),
});

/** 在发送 SSE 响应前完成的上下文准备结果。 */
interface PreparedChat {
  conversation: ChatConversation;
  model: ModelConfig;
  agent: ReturnType<typeof createAgent>;
}

/** 将正式回答和思考过程分开，适配前端已有的 DeepSeek SSE 解析器。 */
export interface ChatStreamChunk {
  content?: string;
  reasoningContent?: string;
}

/**
 * 兼容 LangChain 的字符串内容以及 Anthropic 的分块内容。
 * 工具调用块不在这里输出，避免把内部协议对象直接展示给用户。
 */
const extractContent = (value: unknown): ChatStreamChunk => {
  if (typeof value === 'string') return { content: value };
  if (!Array.isArray(value)) return {};

  let content = '';
  let reasoningContent = '';

  for (const block of value) {
    if (!block || typeof block !== 'object' || !('type' in block)) continue;

    if (
      block.type === 'text' &&
      'text' in block &&
      typeof block.text === 'string'
    ) {
      content += block.text;
    } else if (
      block.type === 'thinking' &&
      'thinking' in block &&
      typeof block.thinking === 'string'
    ) {
      reasoningContent += block.thinking;
    } else if (
      block.type === 'reasoning' &&
      'reasoning' in block &&
      typeof block.reasoning === 'string'
    ) {
      reasoningContent += block.reasoning;
    }
  }

  return {
    content: content || undefined,
    reasoningContent: reasoningContent || undefined,
  };
};

@Injectable()
export class ChatService {
  constructor(
    private readonly modelsService: ModelsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /**
   * 校验请求、解析会话模型、先保存用户消息，再按 ai-agent 的统一配置创建 Agent。
   * 先落盘可以保证模型初始化失败时用户问题仍然留在会话历史中。
   */
  async prepare(payload: unknown): Promise<PreparedChat> {
    const result = chatRequestSchema.safeParse(payload);

    if (!result.success) {
      throw new BadRequestException({
        message: '聊天参数校验失败',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'root',
          message: issue.message,
        })),
      });
    }

    // Provider 会发送当前聊天上下文；服务端历史才是事实来源，因此只取本轮最后一问。
    const lastUserMessage = result.data.messages
      .toReversed()
      .find((message) => message.role === 'user');
    const userContent =
      typeof lastUserMessage?.content === 'string'
        ? lastUserMessage.content.trim()
        : '';

    if (!userContent) {
      throw new BadRequestException('缺少有效的用户消息');
    }

    let conversation = await this.conversationsService.get(
      result.data.conversationId,
    );
    const modelId = result.data.model ?? conversation.modelId;
    const modelRegistry = await this.modelsService.list();
    const model = modelRegistry.models.find((item) => item.id === modelId);

    if (!model) {
      throw new BadRequestException(`找不到模型：${modelId}`);
    }

    // 请求中的模型选择同时写回会话，使刷新页面后仍保持相同模型。
    if (conversation.modelId !== modelId) {
      conversation = await this.conversationsService.update(conversation.id, {
        modelId,
      });
    }

    conversation = await this.conversationsService.appendUserMessage(
      conversation.id,
      userContent,
    );

    try {
      return {
        conversation,
        model,
        agent: createAgent(model),
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '无法初始化 AI Agent',
      );
    }
  }

  /**
   * 使用一次性的内存线程运行 Agent，并逐块产出回答。
   * 浏览器断开或 60 秒超时都会中止底层模型调用；完整输出仅在正常结束后保存。
   */
  async *stream(
    prepared: PreparedChat,
    clientSignal: AbortSignal,
  ): AsyncGenerator<ChatStreamChunk> {
    const signal = AbortSignal.any([
      clientSignal,
      AbortSignal.timeout(60_000),
    ]);
    // 每次创建新 Agent，因此需要把该 Web 会话的完整历史注入新线程。
    const messages = prepared.conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const stream = await prepared.agent.stream(
      { messages },
      {
        configurable: { thread_id: randomUUID() },
        streamMode: ['messages', 'tools'],
        signal,
      },
    );
    let content = '';
    let reasoningContent = '';

    for await (const event of stream) {
      // tools 事件由 Agent 内部消费；页面当前只渲染模型消息流。
      if (!Array.isArray(event) || event[0] !== 'messages') continue;

      const payload = event[1];
      if (!Array.isArray(payload)) continue;

      const message = payload[0];
      if (
        !message ||
        typeof message !== 'object' ||
        !('getType' in message) ||
        typeof message.getType !== 'function' ||
        message.getType() !== 'ai' ||
        !('content' in message)
      ) {
        continue;
      }

      const chunk = extractContent(message.content);
      if (chunk.content) content += chunk.content;
      if (chunk.reasoningContent) reasoningContent += chunk.reasoningContent;

      if (chunk.content || chunk.reasoningContent) yield chunk;
    }

    // 取消的回答可能不完整，不写入可恢复的服务端历史。
    if (!clientSignal.aborted && (content || reasoningContent)) {
      await this.conversationsService.appendAssistantMessage(
        prepared.conversation.id,
        content,
        reasoningContent,
      );
    }
  }
}
