import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ChatService, type ChatStreamChunk } from './chat.service.js';

/** 把 Agent 文本块包装为前端 Provider 已支持的 OpenAI 兼容事件。 */
const createSsePayload = (
  model: string,
  chunk: ChatStreamChunk,
  finishReason: 'stop' | null = null,
) => ({
  id: `chatcmpl-${Date.now()}`,
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      delta: {
        role: 'assistant',
        content: chunk.content,
        reasoning_content: chunk.reasoningContent,
      },
      finish_reason: finishReason,
    },
  ],
});

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * 流式聊天入口。
   * prepare 在发送响应头前执行，以便参数错误仍能交给 Nest 返回标准 JSON 错误。
   */
  @Post('completions')
  async complete(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const prepared = await this.chatService.prepare(body);
    // 浏览器关闭连接时，把取消信号继续传给 LangChain/模型 SDK。
    const abortController = new AbortController();
    const abortOnClose = () => abortController.abort();

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    response.once('close', abortOnClose);

    try {
      for await (const chunk of this.chatService.stream(
        prepared,
        abortController.signal,
      )) {
        response.write(
          `data: ${JSON.stringify(createSsePayload(prepared.model.model, chunk))}\n\n`,
        );
      }
    } catch (error) {
      // 响应头已经发出后不能再切换为 JSON 错误，只能用一个可读的 SSE 文本块收尾。
      if (!abortController.signal.aborted) {
        const message =
          error instanceof Error ? error.message : '未知模型请求错误';
        response.write(
          `data: ${JSON.stringify(
            createSsePayload(prepared.model.model, {
              content: `\n\n> 模型请求失败：${message}`,
            }),
          )}\n\n`,
        );
      }
    } finally {
      response.off('close', abortOnClose);

      // DeepSeekChatProvider 依赖 finish_reason 和 [DONE] 判断流已完整结束。
      if (!response.writableEnded && !response.destroyed) {
        response.write(
          `data: ${JSON.stringify(
            createSsePayload(prepared.model.model, {}, 'stop'),
          )}\n\n`,
        );
        response.write('data: [DONE]\n\n');
        response.end();
      }
    }
  }
}
