export interface ModelConfig {
  id: string;
  name: string;
  /** 上游 API 兼容协议；服务端据此选择 LangChain 客户端。 */
  provider: 'anthropic' | 'openai';
  model: string;
  apiKeyEnv: string;
  baseUrl?: string;
  baseUrlEnv?: string;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  /** 服务端按模型家族强制回填最大输出长度；新建模型时可以暂缺。 */
  maxTokens?: number;
}

export interface ModelRegistry {
  version: 1;
  /** 内部记录用户上次主动选择的模型，供后续新会话继承。 */
  activeModelId: string;
  models: ModelConfig[];
}

const MODEL_API_PATH = '/api/ai-server/models';

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

const request = async <T>(path = '', init?: RequestInit): Promise<T> => {
  const response = await fetch(`${MODEL_API_PATH}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload, `模型服务请求失败（${response.status}）`),
    );
  }

  return payload as T;
};

export const listModels = () => request<ModelRegistry>();

export const createModel = (model: ModelConfig) =>
  request<ModelRegistry>('', {
    method: 'POST',
    body: JSON.stringify(model),
  });

export const updateModel = (id: string, model: ModelConfig) =>
  request<ModelRegistry>(`/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(model),
  });

export const deleteModel = (id: string) =>
  request<ModelRegistry>(`/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
