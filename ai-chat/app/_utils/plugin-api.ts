export type PluginType = 'builtin' | 'tool' | 'mcp' | 'skill';

interface BasePluginConfig {
  id: string;
  name: string;
  description: string;
  type: PluginType;
  enabled: boolean;
  system: boolean;
}

export interface BuiltinPluginConfig extends BasePluginConfig {
  type: 'builtin';
  system: true;
  implementation: 'deepagent';
  capabilities: string[];
}

export interface ToolPluginConfig extends BasePluginConfig {
  type: 'tool';
  system: true;
  implementation: 'tiandi_tongshou' | 'docker_sandbox';
  toolNames: string[];
}

export interface McpPluginConfig extends BasePluginConfig {
  type: 'mcp';
  system: false;
  serverName: string;
  transport: 'stdio' | 'http';
  command?: string;
  args: string[];
  cwd?: string;
  /** 子进程环境变量名 -> AI Server 宿主环境变量名。 */
  envVars: Record<string, string>;
  url?: string;
  /** HTTP Header 名称 -> AI Server 宿主环境变量名。 */
  headerEnv: Record<string, string>;
  timeoutMs: number;
}

export interface SkillPluginConfig extends BasePluginConfig {
  type: 'skill';
  system: false;
  path: string;
}

export type PluginConfig =
  | BuiltinPluginConfig
  | ToolPluginConfig
  | McpPluginConfig
  | SkillPluginConfig;

export interface PluginRegistry {
  version: 1;
  plugins: PluginConfig[];
}

export interface PluginTestResult {
  message: string;
  tools?: string[];
  skill?: {
    name: string;
    description: string;
    filePath: string;
    fileCount: number;
  };
}

export type SkillInstallRunner = 'npx' | 'uvx';

export interface SkillInstallResult {
  message: string;
  output: string;
  installed: Array<{
    id: string;
    name: string;
    description: string;
    path: string;
  }>;
  registry: PluginRegistry;
}

const PLUGIN_API_PATH = '/api/ai-server/plugins';

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
  const response = await fetch(`${PLUGIN_API_PATH}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload, `插件服务请求失败（${response.status}）`),
    );
  }

  return payload as T;
};

export const listPlugins = () => request<PluginRegistry>();

export const createPlugin = (plugin: McpPluginConfig | SkillPluginConfig) =>
  request<PluginRegistry>('', {
    method: 'POST',
    body: JSON.stringify(plugin),
  });

export const updatePlugin = (
  id: string,
  plugin: McpPluginConfig | SkillPluginConfig,
) =>
  request<PluginRegistry>(`/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(plugin),
  });

export const setPluginEnabled = (id: string, enabled: boolean) =>
  request<PluginRegistry>(`/${encodeURIComponent(id)}/enabled`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });

export const testPlugin = (id: string) =>
  request<PluginTestResult>(`/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });

/** 测试尚未保存的 MCP 配置，不修改插件注册表。 */
export const testPluginConfig = (plugin: McpPluginConfig) =>
  request<PluginTestResult>('/test-config', {
    method: 'POST',
    body: JSON.stringify(plugin),
  });

/** 通过受限的包执行器下载安装 Skill，并自动注册检测到的新 Skill。 */
export const installSkills = (runner: SkillInstallRunner, args: string[]) =>
  request<SkillInstallResult>('/install-skills', {
    method: 'POST',
    body: JSON.stringify({ runner, args }),
  });

export const deletePlugin = (id: string) =>
  request<PluginRegistry>(`/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
