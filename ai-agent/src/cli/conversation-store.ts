import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
  type StoredMessage,
} from '@langchain/core/messages';

import { LOCAL_STATE_ROOT } from '../config/paths.ts';

const HISTORY_VERSION = 1;
const LEGACY_TOOL_NAMES: Readonly<Record<string, string>> = {
  天地同寿算法: 'tiandi_tongshou',
};

export const CONVERSATION_FILE = join(
  LOCAL_STATE_ROOT,
  'conversation.json',
);

interface StoredConversation {
  version: number;
  updatedAt: string;
  messages: StoredMessage[];
}

/**
 * 将旧会话中的非 ASCII 工具名迁移为跨模型兼容名称。
 * 这里只替换结构化对象的 name 字段，不修改用户消息或回答正文。
 */
const normalizeStoredToolNames = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeStoredToolNames);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      if (key === 'name' && typeof nestedValue === 'string') {
        return [key, LEGACY_TOOL_NAMES[nestedValue] ?? nestedValue];
      }

      return [key, normalizeStoredToolNames(nestedValue)];
    }),
  );
};

const isStoredConversation = (value: unknown): value is StoredConversation => {
  if (!value || typeof value !== 'object') return false;

  const conversation = value as Partial<StoredConversation>;
  return (
    conversation.version === HISTORY_VERSION &&
    typeof conversation.updatedAt === 'string' &&
    Array.isArray(conversation.messages)
  );
};

/** 从 JSON 文件恢复 LangChain 消息对象。文件不存在时视为新会话。 */
export const loadConversationHistory = async (
  filePath = CONVERSATION_FILE,
): Promise<BaseMessage[]> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const storedConversation: unknown = JSON.parse(content);

    if (!isStoredConversation(storedConversation)) {
      throw new Error('文件结构或版本不受支持');
    }

    const normalizedMessages = normalizeStoredToolNames(
      storedConversation.messages,
    ) as StoredMessage[];

    return mapStoredMessagesToChatMessages(normalizedMessages);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [];
    }

    throw new Error(`无法读取本地会话文件 ${filePath}`, { cause: error });
  }
};

/** 将完整消息链原子写入 JSON，保留工具调用参数与 tool_call_id。 */
export const saveConversationHistory = async (
  messages: BaseMessage[],
  filePath = CONVERSATION_FILE,
) => {
  const storedConversation: StoredConversation = {
    version: HISTORY_VERSION,
    updatedAt: new Date().toISOString(),
    messages: mapChatMessagesToStoredMessages(messages),
  };

  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    temporaryFile,
    `${JSON.stringify(storedConversation, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  await rename(temporaryFile, filePath);
};
