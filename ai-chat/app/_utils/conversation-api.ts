/**
 * Web 会话 API 客户端。
 * 浏览器只访问 Next.js 的同源代理路径，真实数据由 Nest AI Server 持久化。
 */

/** 一条已经写入服务端会话文件的消息。 */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoningContent?: string;
  createdAt: string;
}

/** 会话详情；进入会话时用它恢复完整历史消息。 */
export interface ChatConversation {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

/** 会话列表只返回消息数量，避免侧边栏初始化时下载所有历史内容。 */
export interface ConversationSummary
  extends Omit<ChatConversation, 'messages'> {
  messageCount: number;
}

const CONVERSATION_API_PATH = '/api/ai-server/conversations';

/** 将 Nest 的统一错误结构转换成可直接展示给用户的中文信息。 */
const getErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') return fallback;

  const response = payload as {
    message?: unknown;
    details?: Array<{ field?: unknown; message?: unknown }>;
  };

  if (Array.isArray(response.details) && response.details.length > 0) {
    return response.details
      .map(({ field, message }) =>
        [field, message].filter((value) => typeof value === 'string').join(': '),
      )
      .filter(Boolean)
      .join('；');
  }

  if (Array.isArray(response.message)) return response.message.join('；');
  if (typeof response.message === 'string') return response.message;
  return fallback;
};

/**
 * 统一处理会话请求和错误响应。
 * 所有写操作均发送 JSON，路径由 Next.js rewrite 转发到 Nest `/api`。
 */
const request = async <T>(path = '', init?: RequestInit): Promise<T> => {
  const response = await fetch(`${CONVERSATION_API_PATH}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload, `会话服务请求失败（${response.status}）`),
    );
  }

  return payload as T;
};

/** 获取按更新时间倒序排列的会话摘要。 */
export const listConversations = () => request<ConversationSummary[]>();

/** 获取单个会话及其完整消息历史。 */
export const getConversation = (id: string) =>
  request<ChatConversation>(`/${encodeURIComponent(id)}`);

/** 新建会话；未指定模型时由服务端继承用户上次主动选择的模型。 */
export const createConversation = (input?: {
  title?: string;
  modelId?: string;
}) =>
  request<ChatConversation>('', {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });

/** 更新会话标题或该会话绑定的模型。 */
export const updateConversation = (
  id: string,
  input: { title?: string; modelId?: string },
) =>
  request<ChatConversation>(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

/** 删除会话及其全部历史消息。 */
export const deleteConversation = (id: string) =>
  request<{ id: string }>(`/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
