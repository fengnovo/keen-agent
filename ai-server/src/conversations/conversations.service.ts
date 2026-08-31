/**
 * Web 会话持久化服务。
 * 会话与命令行 Agent 的历史分开保存，但二者共用同一份模型注册表。
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { ModelsService } from '../models/models.service.js';

const CHAT_CONVERSATIONS_VERSION = 1;

/** 磁盘消息结构，reasoningContent 用于刷新后恢复思考区。 */
const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  reasoningContent: z.string().optional(),
  createdAt: z.string().datetime(),
});

/** 单个会话同时保存会话级模型和完整消息链。 */
const conversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(chatMessageSchema),
});

/** 使用版本字段为后续文件结构迁移预留空间。 */
const conversationStoreSchema = z.object({
  version: z.literal(CHAT_CONVERSATIONS_VERSION),
  conversations: z.array(conversationSchema),
});

/** 创建和更新请求只接收允许由页面修改的字段。 */
const createConversationSchema = z.object({
  title: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
});

const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    modelId: z.string().trim().min(1).optional(),
  })
  .refine((value) => value.title !== undefined || value.modelId !== undefined, {
    message: '至少需要提供 title 或 modelId',
  });

export type ChatMessageRecord = z.infer<typeof chatMessageSchema>;
export type ChatConversation = z.infer<typeof conversationSchema>;
type ConversationStore = z.infer<typeof conversationStoreSchema>;

export interface ConversationSummary
  extends Omit<ChatConversation, 'messages'> {
  messageCount: number;
}

/** 默认存储在仓库根目录的私有运行数据目录中。 */
export const CHAT_CONVERSATIONS_FILE = fileURLToPath(
  new URL('../../../.keen-agent/chat-conversations.json', import.meta.url),
);

const EMPTY_STORE: ConversationStore = {
  version: CHAT_CONVERSATIONS_VERSION,
  conversations: [],
};

@Injectable()
export class ConversationsService {
  private readonly filePath =
    process.env.CHAT_CONVERSATIONS_PATH?.trim() || CHAT_CONVERSATIONS_FILE;

  /** 串行化所有写操作，防止并发请求相互覆盖 JSON 文件。 */
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly modelsService: ModelsService) {}

  /** 返回不含 messages 的摘要，并让最近更新的会话排在最前。 */
  async list(): Promise<ConversationSummary[]> {
    await this.mutationQueue;
    const store = await this.loadStore();

    return store.conversations
      .map(({ messages, ...conversation }) => ({
        ...conversation,
        messageCount: messages.length,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** 获取单个会话；不存在时统一抛出 404。 */
  async get(id: string): Promise<ChatConversation> {
    await this.mutationQueue;
    const store = await this.loadStore();
    return this.findOrThrow(store, id);
  }

  /** 创建会话；未指定模型时继承模型注册表记录的上次选择。 */
  async create(payload: unknown): Promise<ChatConversation> {
    const input = this.parse(createConversationSchema, payload);
    const modelRegistry = await this.modelsService.list();
    const modelId = input.modelId ?? modelRegistry.activeModelId;

    if (!modelRegistry.models.some((model) => model.id === modelId)) {
      throw new BadRequestException(`找不到模型：${modelId}`);
    }

    return this.mutate((store) => {
      const now = new Date().toISOString();
      const conversation: ChatConversation = {
        id: randomUUID(),
        title: input.title ?? '新会话',
        modelId,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };

      store.conversations.unshift(conversation);
      return conversation;
    });
  }

  /**
   * 更新标题或当前会话模型，并推进侧边栏排序所依赖的 updatedAt。
   * 用户选择模型时只改这一条会话，同时把该模型记为未来新会话的继承值。
   */
  async update(id: string, payload: unknown): Promise<ChatConversation> {
    const input = this.parse(updateConversationSchema, payload);

    if (input.modelId) {
      await this.modelsService.get(input.modelId);
    }

    const conversation = await this.mutate((store) => {
      const conversation = this.findOrThrow(store, id);

      if (input.title !== undefined) conversation.title = input.title;
      if (input.modelId !== undefined) conversation.modelId = input.modelId;
      conversation.updatedAt = new Date().toISOString();
      return conversation;
    });

    if (input.modelId) {
      await this.modelsService.activate(input.modelId);
    }

    return conversation;
  }

  /** 删除会话；删除最后一个会话后的补建策略由前端负责。 */
  remove(id: string): Promise<{ id: string }> {
    return this.mutate((store) => {
      this.findOrThrow(store, id);
      store.conversations = store.conversations.filter(
        (conversation) => conversation.id !== id,
      );
      return { id };
    });
  }

  /**
   * 在调用模型前保存用户消息。
   * 第一条消息会自动成为默认标题，保证流式请求失败时提问仍可恢复。
   */
  appendUserMessage(
    id: string,
    content: string,
  ): Promise<ChatConversation> {
    return this.mutate((store) => {
      const conversation = this.findOrThrow(store, id);
      const now = new Date().toISOString();

      conversation.messages.push({
        id: randomUUID(),
        role: 'user',
        content,
        createdAt: now,
      });

      if (
        conversation.messages.length === 1 &&
        conversation.title === '新会话'
      ) {
        conversation.title = content.replace(/\s+/g, ' ').slice(0, 30);
      }

      conversation.updatedAt = now;
      return conversation;
    });
  }

  /** 模型流正常结束后，将正式回答和思考内容一起原子落盘。 */
  appendAssistantMessage(
    id: string,
    content: string,
    reasoningContent?: string,
  ): Promise<ChatConversation> {
    return this.mutate((store) => {
      const conversation = this.findOrThrow(store, id);
      const now = new Date().toISOString();

      conversation.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content,
        reasoningContent: reasoningContent || undefined,
        createdAt: now,
      });
      conversation.updatedAt = now;
      return conversation;
    });
  }

  /** 把 Zod 校验问题转换为前端 API 客户端可解析的字段列表。 */
  private parse<T>(schema: z.ZodType<T>, payload: unknown): T {
    const result = schema.safeParse(payload);

    if (!result.success) {
      throw new BadRequestException({
        message: '会话参数校验失败',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'root',
          message: issue.message,
        })),
      });
    }

    return result.data;
  }

  /** 在所有 CRUD 路径上复用一致的 404 行为。 */
  private findOrThrow(store: ConversationStore, id: string): ChatConversation {
    const conversation = store.conversations.find((item) => item.id === id);

    if (!conversation) {
      throw new NotFoundException(`找不到会话：${id}`);
    }

    return conversation;
  }

  /** 文件尚不存在时返回空存储，其余读取或格式错误必须显式暴露。 */
  private async loadStore(): Promise<ConversationStore> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      return conversationStoreSchema.parse(JSON.parse(content));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return structuredClone(EMPTY_STORE);
      }

      throw new Error(`无法读取 Web 会话文件 ${this.filePath}`, {
        cause: error,
      });
    }
  }

  /** 先写临时文件再 rename，避免进程中断留下半截 JSON。 */
  private async saveStore(store: ConversationStore): Promise<void> {
    const validatedStore = conversationStoreSchema.parse(store);
    const temporaryFile = `${this.filePath}.${process.pid}.tmp`;

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      temporaryFile,
      `${JSON.stringify(validatedStore, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await rename(temporaryFile, this.filePath);
  }

  /**
   * 把“读取 → 修改 → 保存”作为一个串行事务执行；失败不会阻塞后续写入。
   */
  private mutate<T>(
    operation: (store: ConversationStore) => T,
  ): Promise<T> {
    const result = this.mutationQueue.then(async () => {
      const store = await this.loadStore();
      const operationResult = operation(store);

      await this.saveStore(store);
      return operationResult;
    });

    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
