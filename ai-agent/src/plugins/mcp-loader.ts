import { isAbsolute, resolve } from 'node:path';
import { MultiServerMCPClient, type Connection } from '@langchain/mcp-adapters';

import type { McpPluginConfig } from '../config/plugin-config.ts';
import { MCP_ROOT } from '../config/paths.ts';

export type McpTools = Awaited<ReturnType<MultiServerMCPClient['getTools']>>;

export interface McpLoadFailure {
  pluginId: string;
  pluginName: string;
  message: string;
}

export interface LoadedMcpTools {
  tools: McpTools;
  failures: McpLoadFailure[];
  close: () => Promise<void>;
}

/**
 * MCP Adapter 的原始异常可能包含完整 URL、回退过程和底层堆栈。
 * 对聊天与管理页只暴露可行动且不包含连接地址/鉴权参数的摘要。
 */
const formatMcpConnectionError = (
  plugin: McpPluginConfig,
  error: unknown,
): string => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  let detail: string;

  if (/current user is in debt/i.test(rawMessage)) {
    detail = '远端服务账号欠费或额度不可用（Current user is in debt）';
  } else if (/\b401\b|unauthori[sz]ed|authentication/i.test(rawMessage)) {
    detail = '远端服务鉴权失败（HTTP 401）';
  } else if (/\b403\b|access denied|forbidden/i.test(rawMessage)) {
    detail = '远端服务拒绝访问（HTTP 403）';
  } else if (/timeout|timed out|aborted/i.test(rawMessage)) {
    detail = '连接远端服务超时';
  } else {
    detail = rawMessage
      .replace(/https?:\/\/[^\s"')]+/gi, '<MCP endpoint>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300) || '未知连接错误';
  }

  return `MCP 插件“${plugin.name}”连接失败：${detail}`;
};

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
    return { tools: [], failures: [], close: async () => undefined };
  }

  // 每个 MCP 使用独立客户端连接。一个可选插件故障时保留其他插件能力，
  // 避免 Agent 在模型开始回答之前整体初始化失败。
  const loaded = await Promise.all(
    plugins.map(async (plugin) => {
      const client = createMcpClient([plugin]);
      try {
        return {
          plugin,
          client,
          tools: await client.getTools(),
        };
      } catch (error) {
        await client.close().catch(() => undefined);
        const message = formatMcpConnectionError(plugin, error);
        console.warn('[mcp] plugin unavailable', {
          pluginId: plugin.id,
          serverName: plugin.serverName,
          message,
        });
        return { plugin, message };
      }
    }),
  );
  const successful = loaded.filter(
    (
      item,
    ): item is Extract<(typeof loaded)[number], { client: unknown }> =>
      'client' in item,
  );
  const failures = loaded
    .filter((item) => 'message' in item)
    .map((item) => ({
      pluginId: item.plugin.id,
      pluginName: item.plugin.name,
      message: item.message!,
    }));

  return {
    tools: successful.flatMap((item) => item.tools),
    failures,
    close: async () => {
      await Promise.allSettled(
        successful.map((item) => item.client.close()),
      );
    },
  };
};

export const testMcpPlugin = async (plugin: McpPluginConfig) => {
  const runtime = await loadMcpTools([plugin]);
  try {
    const failure = runtime.failures[0];
    if (failure) {
      throw new Error(failure.message);
    }
    return runtime.tools.map((tool) => tool.name);
  } finally {
    await runtime.close();
  }
};
