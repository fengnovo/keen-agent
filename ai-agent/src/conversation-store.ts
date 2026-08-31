import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
  type StoredMessage,
} from '@langchain/core/messages';

const HISTORY_VERSION = 1;

export const CONVERSATION_FILE = fileURLToPath(
  new URL('../_data/conversation.json', import.meta.url),
);

interface StoredConversation {
  version: number;
  updatedAt: string;
  messages: StoredMessage[];
}

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

    return mapStoredMessagesToChatMessages(storedConversation.messages);
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
