import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { LOCAL_STATE_ROOT } from './paths.ts';

const PLUGIN_CONFIG_VERSION = 1;
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LEGACY_SKILLS_PREFIX = 'ai-agent/skills';
const SKILLS_PREFIX = 'ai-agent/.skills';

const basePluginShape = {
  id: z.string().trim().min(1).max(64).regex(PLUGIN_ID_PATTERN),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  enabled: z.boolean().default(true),
};

/** DeepAgent 自带能力以一个系统插件呈现；实现仍由 DeepAgent 运行时提供。 */
export const builtinPluginSchema = z.object({
  ...basePluginShape,
  type: z.literal('builtin'),
  system: z.literal(true),
  implementation: z.literal('deepagent'),
  capabilities: z.array(z.string().trim().min(1)).min(1),
});

/** 本地 TypeScript 工具只保存实现标识，不能从管理页面注入任意代码。 */
export const toolPluginSchema = z.object({
  ...basePluginShape,
  type: z.literal('tool'),
  system: z.literal(true),
  implementation: z.enum(['tiandi_tongshou', 'docker_sandbox']),
  toolNames: z.array(z.string().trim().min(1)).min(1),
});

const environmentMappingSchema = z.record(
  z.string().trim().min(1),
  z.string().trim().regex(ENV_NAME_PATTERN),
);

/**
 * MCP 配置只记录环境变量名称：stdio 的 envVars 为“子进程变量 -> 宿主变量”，
 * HTTP 的 headerEnv 为“Header 名称 -> 宿主变量”，不会把密钥写进 JSON。
 */
export const mcpPluginSchema = z
  .object({
    ...basePluginShape,
    type: z.literal('mcp'),
    system: z.literal(false).default(false),
    serverName: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(MCP_SERVER_NAME_PATTERN),
    transport: z.enum(['stdio', 'http']),
    command: z.string().trim().min(1).optional(),
    args: z.array(z.string()).max(50).default([]),
    cwd: z.string().trim().min(1).optional(),
    envVars: environmentMappingSchema.default({}),
    url: z.string().url().optional(),
    headerEnv: environmentMappingSchema.default({}),
    timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),
  })
  .superRefine((plugin, context) => {
    if (plugin.transport === 'http' && !plugin.url) {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'HTTP MCP 必须配置服务地址',
      });
    }
  });

/** 一个 Skill 插件对应一个符合 Agent Skills 规范的 SKILL.md。 */
export const skillPluginSchema = z.object({
  ...basePluginShape,
  type: z.literal('skill'),
  system: z.literal(false).default(false),
  path: z.string().trim().min(1).max(2_048),
});

export const pluginConfigSchema = z.discriminatedUnion('type', [
  builtinPluginSchema,
  toolPluginSchema,
  mcpPluginSchema,
  skillPluginSchema,
]);

export const pluginRegistrySchema = z
  .object({
    version: z.literal(PLUGIN_CONFIG_VERSION),
    plugins: z.array(pluginConfigSchema),
  })
  .superRefine((registry, context) => {
    const ids = new Set<string>();
    const serverNames = new Set<string>();

    registry.plugins.forEach((plugin, index) => {
      if (ids.has(plugin.id)) {
        context.addIssue({
          code: 'custom',
          path: ['plugins', index, 'id'],
          message: `插件 id 重复：${plugin.id}`,
        });
      }
      ids.add(plugin.id);

      if (plugin.type === 'mcp') {
        if (serverNames.has(plugin.serverName)) {
          context.addIssue({
            code: 'custom',
            path: ['plugins', index, 'serverName'],
            message: `MCP 服务名称重复：${plugin.serverName}`,
          });
        }
        serverNames.add(plugin.serverName);
      }
    });

    for (const requiredId of ['deepagent-core', 'tiandi-tongshou']) {
      if (!ids.has(requiredId)) {
        context.addIssue({
          code: 'custom',
          path: ['plugins'],
          message: `缺少系统插件：${requiredId}`,
        });
      }
    }
  });

export type BuiltinPluginConfig = z.infer<typeof builtinPluginSchema>;
export type ToolPluginConfig = z.infer<typeof toolPluginSchema>;
export type McpPluginConfig = z.infer<typeof mcpPluginSchema>;
export type SkillPluginConfig = z.infer<typeof skillPluginSchema>;
export type PluginConfig = z.infer<typeof pluginConfigSchema>;
export type PluginRegistry = z.infer<typeof pluginRegistrySchema>;

export interface LoadedPluginRegistry {
  registry: PluginRegistry;
  created: boolean;
}

export const PLUGIN_CONFIG_FILE = join(LOCAL_STATE_ROOT, 'plugins.json');

export const createDefaultPluginRegistry = (): PluginRegistry =>
  pluginRegistrySchema.parse({
    version: PLUGIN_CONFIG_VERSION,
    plugins: [
      {
        id: 'deepagent-core',
        name: 'DeepAgent 内置工具',
        description:
          '规划、临时文件工作区、内容检索和任务委派等 DeepAgent 核心能力。',
        type: 'builtin',
        system: true,
        implementation: 'deepagent',
        capabilities: [
          'ls',
          'read_file',
          'write_file',
          'edit_file',
          'delete',
          'glob',
          'grep',
          'task',
        ],
        enabled: true,
      },
      {
        id: 'tiandi-tongshou',
        name: '天地同寿算法',
        description: '项目示例计算工具：返回两个数之和再加 100。',
        type: 'tool',
        system: true,
        implementation: 'tiandi_tongshou',
        toolNames: ['tiandi_tongshou'],
        enabled: true,
      },
      {
        id: 'docker-sandbox',
        name: 'Docker 隔离执行器',
        description:
          '在本机 Docker 的受限容器中执行命令、处理文件并生成可下载产物。',
        type: 'tool',
        system: true,
        implementation: 'docker_sandbox',
        toolNames: [
          'execute',
          'ls',
          'read_file',
          'write_file',
          'edit_file',
          'glob',
          'grep',
          'artifact-download',
          'web-preview',
        ],
        enabled: true,
      },
    ],
  });

export const formatPluginValidationError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

/** 把早期 Skill 路径升级，并为旧注册表补上新增的系统沙箱插件。 */
const migratePluginRegistry = (
  registry: PluginRegistry,
): { registry: PluginRegistry; changed: boolean } => {
  let changed = false;
  const plugins = registry.plugins.map((plugin) => {
    if (
      plugin.type !== 'skill' ||
      (plugin.path !== LEGACY_SKILLS_PREFIX &&
        !plugin.path.startsWith(`${LEGACY_SKILLS_PREFIX}/`))
    ) {
      return plugin;
    }

    changed = true;
    return {
      ...plugin,
      path: `${SKILLS_PREFIX}${plugin.path.slice(LEGACY_SKILLS_PREFIX.length)}`,
    };
  });

  if (!plugins.some((plugin) => plugin.id === 'docker-sandbox')) {
    plugins.push(
      createDefaultPluginRegistry().plugins.find(
        (plugin) => plugin.id === 'docker-sandbox',
      )!,
    );
    changed = true;
  }

  const dockerSandbox = plugins.find(
    (plugin) => plugin.id === 'docker-sandbox' && plugin.type === 'tool',
  );
  if (
    dockerSandbox?.type === 'tool' &&
    !dockerSandbox.toolNames.includes('web-preview')
  ) {
    dockerSandbox.toolNames.push('web-preview');
    changed = true;
  }

  return {
    registry: changed
      ? pluginRegistrySchema.parse({ ...registry, plugins })
      : registry,
    changed,
  };
};

/** 原子保存插件注册表，避免并发写入留下半截 JSON。 */
export const savePluginRegistry = async (
  registry: PluginRegistry,
  filePath = PLUGIN_CONFIG_FILE,
): Promise<void> => {
  const validatedRegistry = pluginRegistrySchema.parse(registry);
  const temporaryFile = `${filePath}.${process.pid}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    temporaryFile,
    `${JSON.stringify(validatedRegistry, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  await rename(temporaryFile, filePath);
};

/** 首次运行创建系统插件；后续只读取用户维护的注册表。 */
export const loadPluginRegistry = async (
  filePath = PLUGIN_CONFIG_FILE,
): Promise<LoadedPluginRegistry> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const result = pluginRegistrySchema.safeParse(JSON.parse(content));

    if (!result.success) {
      throw new Error(formatPluginValidationError(result.error));
    }

    const migrated = migratePluginRegistry(result.data);
    if (migrated.changed) {
      await savePluginRegistry(migrated.registry, filePath);
    }

    return { registry: migrated.registry, created: false };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      const registry = createDefaultPluginRegistry();
      await savePluginRegistry(registry, filePath);
      return { registry, created: true };
    }

    throw new Error(`无法读取插件配置文件 ${filePath}`, { cause: error });
  }
};
