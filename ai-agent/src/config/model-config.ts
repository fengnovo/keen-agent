import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { LOCAL_STATE_ROOT } from './paths.ts';

const MODEL_CONFIG_VERSION = 1;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 当前已接入模型的最大输出长度（token）。
 *
 * Provider 的 `max_tokens` 不会因为模型升级自动取最大值，因此在服务端集中按
 * 模型家族覆盖，避免各入口漏传后退回 SDK 的较小默认值。
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 131_072;

/**
 * 单次模型请求的默认超时（毫秒）。
 *
 * Agent 场景下单次要长推理或整份文件流式输出，旧版 15s 会在生成途中被
 * AbortSignal 中止（“The operation was aborted due to timeout”）。这里放宽到
 * 5 分钟，与前端 310s 的整体流式超时留出余量。
 */
export const DEFAULT_MODEL_TIMEOUT_MS = 300_000;

/**
 * 低于该值的总超时对流式 Agent 任务必然误杀，视为旧版默认值，加载时自动升级。
 */
export const LEGACY_MODEL_TIMEOUT_FLOOR_MS = 60_000;

export const getMaximumOutputTokens = (
  model: string,
  configuredMaximum?: number,
): number => {
  const normalizedModel = model.trim().toLowerCase().split('/').at(-1) ?? '';

  if (normalizedModel === 'qwen3.5-ocr') return 16_384;
  if (normalizedModel === 'kimi-k3') return 1_048_576;
  if (normalizedModel.startsWith('deepseek-v4')) return 393_216;
  if (normalizedModel.startsWith('qwen3.8')) return 131_072;

  // 未登记的新模型优先采用管理员明确填写的上限；没有配置时使用平台默认上限。
  return configuredMaximum ?? DEFAULT_MAX_OUTPUT_TOKENS;
};

export const modelConfigSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    // provider 表示兼容协议而非模型厂商，用于选择对应的 LangChain 客户端。
    provider: z.enum(['anthropic', 'openai']),
    model: z.string().trim().min(1),
    apiKeyEnv: z.string().regex(ENV_NAME_PATTERN),
    baseUrl: z.string().url().optional(),
    baseUrlEnv: z.string().regex(ENV_NAME_PATTERN).optional(),
    temperature: z.number().min(0).max(1).default(0),
    timeoutMs: z.number().int().positive().default(DEFAULT_MODEL_TIMEOUT_MS),
    maxRetries: z.number().int().min(0).max(10).default(1),
    maxTokens: z.number().int().positive().optional(),
  })
  .transform((config) => ({
    ...config,
    // 旧版 15s 默认值对长推理/整份文件的流式生成必然误超时；低于下限的配置
    // 自动升级为新默认值，用户显式设置的较大超时保持不变。
    timeoutMs:
      config.timeoutMs < LEGACY_MODEL_TIMEOUT_FLOOR_MS
        ? DEFAULT_MODEL_TIMEOUT_MS
        : config.timeoutMs,
    // 已登记模型始终覆盖为真实上限，不允许旧配置或页面表单把它调低。
    maxTokens: getMaximumOutputTokens(config.model, config.maxTokens),
  }));

export const modelRegistrySchema = z
  .object({
    version: z.literal(MODEL_CONFIG_VERSION),
    activeModelId: z.string().trim().min(1),
    models: z.array(modelConfigSchema).min(1),
  })
  .superRefine((registry, context) => {
    const ids = new Set<string>();

    registry.models.forEach((model, index) => {
      if (ids.has(model.id)) {
        context.addIssue({
          code: 'custom',
          message: `模型 id 重复：${model.id}`,
          path: ['models', index, 'id'],
        });
      }
      ids.add(model.id);
    });

    if (!ids.has(registry.activeModelId)) {
      context.addIssue({
        code: 'custom',
        message: `activeModelId 对应的模型不存在：${registry.activeModelId}`,
        path: ['activeModelId'],
      });
    }
  });

export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ModelRegistry = z.infer<typeof modelRegistrySchema>;

export interface ResolvedModelConfig extends ModelConfig {
  apiKey: string;
  baseURL?: string;
}

export interface LoadedModelRegistry {
  registry: ModelRegistry;
  created: boolean;
}

export const MODEL_CONFIG_FILE = join(LOCAL_STATE_ROOT, 'models.json');

export const formatModelValidationError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

const createDefaultModelRegistry = (): ModelRegistry => {
  const model = process.env.MODEL?.trim();
  if (!model) {
    throw new Error(
      `未找到 ${MODEL_CONFIG_FILE}，且环境变量 MODEL 未配置，无法生成默认模型配置`,
    );
  }

  return modelRegistrySchema.parse({
    version: MODEL_CONFIG_VERSION,
    activeModelId: model,
    models: [
      {
        // 自动生成配置沿用项目最初的 Anthropic 兼容环境变量约定。
        id: model,
        name: model,
        provider: 'anthropic',
        model,
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        baseUrlEnv: 'ANTHROPIC_BASE_URL',
        temperature: 0,
        timeoutMs: DEFAULT_MODEL_TIMEOUT_MS,
        maxRetries: 1,
      },
    ],
  });
};

/** 原子保存模型注册表，避免写入过程中留下不完整 JSON。 */
export const saveModelRegistry = async (
  registry: ModelRegistry,
  filePath = MODEL_CONFIG_FILE,
): Promise<void> => {
  const validatedRegistry = modelRegistrySchema.parse(registry);
  const temporaryFile = `${filePath}.${process.pid}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    temporaryFile,
    `${JSON.stringify(validatedRegistry, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  await rename(temporaryFile, filePath);
};

/** 加载本地模型配置；文件不存在时根据现有环境变量自动生成。 */
export const loadModelRegistry = async (
  filePath = MODEL_CONFIG_FILE,
): Promise<LoadedModelRegistry> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    const result = modelRegistrySchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(formatModelValidationError(result.error));
    }

    // 读取旧配置时把缺失/过小的 maxTokens 以及其他默认值一次性写回磁盘。
    if (JSON.stringify(parsed) !== JSON.stringify(result.data)) {
      await saveModelRegistry(result.data, filePath);
    }

    return { registry: result.data, created: false };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      const registry = createDefaultModelRegistry();
      await saveModelRegistry(registry, filePath);
      return { registry, created: true };
    }

    throw new Error(`无法读取模型配置文件 ${filePath}`, { cause: error });
  }
};

export const getActiveModel = (registry: ModelRegistry): ModelConfig => {
  const activeModel = registry.models.find(
    (model) => model.id === registry.activeModelId,
  );

  if (!activeModel) {
    throw new Error(`找不到当前模型：${registry.activeModelId}`);
  }

  return activeModel;
};

/** 支持用列表序号或模型 id 选择模型。 */
export const findModel = (
  registry: ModelRegistry,
  selection: string,
): ModelConfig | undefined => {
  const modelIndex = Number(selection);
  if (Number.isInteger(modelIndex) && modelIndex >= 1) {
    return registry.models[modelIndex - 1];
  }

  const normalizedSelection = selection.toLowerCase();
  return registry.models.find(
    (model) => model.id.toLowerCase() === normalizedSelection,
  );
};

export const withActiveModel = (
  registry: ModelRegistry,
  activeModelId: string,
): ModelRegistry =>
  modelRegistrySchema.parse({
    ...registry,
    activeModelId,
  });

/** 解析 API Key 和 Base URL；调用方再根据 provider 创建具体模型客户端。 */
export const resolveModelConfig = (
  config: ModelConfig,
): ResolvedModelConfig => {
  const apiKey = process.env[config.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw new Error(
      `模型 ${config.id} 所需的环境变量 ${config.apiKeyEnv} 未配置`,
    );
  }

  const baseURL =
    config.baseUrl ??
    (config.baseUrlEnv
      ? process.env[config.baseUrlEnv]?.trim() || undefined
      : undefined);

  if (config.baseUrlEnv && !baseURL) {
    throw new Error(
      `模型 ${config.id} 所需的环境变量 ${config.baseUrlEnv} 未配置`,
    );
  }

  return {
    ...config,
    apiKey,
    baseURL,
  };
};
