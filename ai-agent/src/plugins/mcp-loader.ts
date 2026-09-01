import { isAbsolute, resolve } from 'node:path';
import { MultiServerMCPClient, type Connection } from '@langchain/mcp-adapters';

import type { McpPluginConfig } from '../config/plugin-config.ts';
import { MCP_ROOT } from '../config/paths.ts';

export type McpTools = Awaited<ReturnType<MultiServerMCPClient['getTools']>>;

export interface LoadedMcpTools {
  tools: McpTools;
  close: () => Promise<void>;
}

const resolveConfiguredValues = (
  mapping: Record<string, string>,
  pluginName: string,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(mapping).map(([targetName, sourceEnv]) => {
      const value = process.env[sourceEnv]?.trim();

      if (!value) {
        throw new Error(
          `插件 ${pluginName} 所需的环境变量 ${sourceEnv} 未配置`,
        );
      }

      return [targetName, value];
    }),
  );

const resolveMcpCwd = (plugin: McpPluginConfig): string | undefined => {
  if (!plugin.cwd) return undefined;
  if (isAbsolute(plugin.cwd)) return plugin.cwd;

  // 本地 MCP 的相对工作目录固定落在 .mcp/<插件 ID>/ 下。
  return resolve(MCP_ROOT, plugin.id, plugin.cwd);
};

/** 将管理页配置转换成 MCP Adapter 接受的严格连接结构。 */
const toMcpConnection = (plugin: McpPluginConfig): Connection => {
  if (plugin.transport === 'stdio') {
    if (!plugin.command) {
      throw new Error(`stdio MCP 插件 ${plugin.name} 缺少启动命令`);
    }

    return {
      transport: 'stdio',
      command: plugin.command,
      args: plugin.args,
      cwd: resolveMcpCwd(plugin),
      env:
        Object.keys(plugin.envVars).length > 0
          ? resolveConfiguredValues(plugin.envVars, plugin.name)
          : undefined,
      defaultToolTimeout: plugin.timeoutMs,
    };
  }

  if (!plugin.url) {
    throw new Error(`HTTP MCP 插件 ${plugin.name} 缺少服务地址`);
  }

  return {
    transport: 'http',
    url: plugin.url,
    headers:
      Object.keys(plugin.headerEnv).length > 0
        ? resolveConfiguredValues(plugin.headerEnv, plugin.name)
        : undefined,
    defaultToolTimeout: plugin.timeoutMs,
  };
};

const createMcpClient = (plugins: McpPluginConfig[]) =>
  new MultiServerMCPClient({
    mcpServers: Object.fromEntries(
      plugins.map((plugin) => [plugin.serverName, toMcpConnection(plugin)]),
    ),
    // 避免不同服务暴露同名工具，并显式标识工具来源。
    prefixToolNameWithServerName: true,
    useStandardContentBlocks: true,
    onConnectionError: 'throw',
  });

/** 为一次 Agent 运行装载 MCP 工具，并把连接清理职责交给调用方。 */
export const loadMcpTools = async (
  plugins: McpPluginConfig[],
): Promise<LoadedMcpTools> => {
  if (plugins.length === 0) {
    return { tools: [], close: async () => undefined };
  }

  const client = createMcpClient(plugins);
  try {
    return {
      tools: await client.getTools(),
      close: async () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
};

export const testMcpPlugin = async (plugin: McpPluginConfig) => {
  const runtime = await loadMcpTools([plugin]);
  try {
    return runtime.tools.map((tool) => tool.name);
  } finally {
    await runtime.close();
  }
};
