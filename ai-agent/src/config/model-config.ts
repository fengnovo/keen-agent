import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { LOCAL_STATE_ROOT } from './paths.ts';

const MODEL_CONFIG_VERSION = 1;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const modelConfigSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  // provider 表示兼容协议而非模型厂商，用于选择对应的 LangChain 客户端。
  provider: z.enum(['anthropic', 'openai']),
  model: z.string().trim().min(1),
  apiKeyEnv: z.string().regex(ENV_NAME_PATTERN),
  baseUrl: z.string().url().optional(),
  baseUrlEnv: z.string().regex(ENV_NAME_PATTERN).optional(),
  temperature: z.number().min(0).max(1).default(0),
  timeoutMs: z.number().int().positive().default(15_000),
  maxRetries: z.number().int().min(0).max(10).default(1),
  maxTokens: z.number().int().positive().optional(),
});

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
        timeoutMs: 15_000,
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
