import type { McpPluginConfig } from './plugin-api';

type UnknownRecord = Record<string, unknown>;

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_REFERENCE_PATTERN = /^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}$/;

export const MCP_JSON_EXAMPLE = `{
  "id": "weather-mcp",
  "name": "天气查询",
  "description": "通过 MCP 查询天气",
  "mcpServers": {
    "weather": {
      "type": "streamable_http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "\${MCP_AUTHORIZATION}"
      }
    }
  }
}`;

const asObject = (value: unknown, label: string): UnknownRecord => {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return value as UnknownRecord;
};

const optionalString = (
  value: unknown,
  label: string,
): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`);
  return value.trim() || undefined;
};

const normalizeEnvironmentMap = (
  value: unknown,
  label: string,
): Record<string, string> => {
  if (value === undefined) return {};
  const mapping = asObject(value, label);

  return Object.fromEntries(
    Object.entries(mapping).map(([targetName, sourceValue]) => {
      if (typeof sourceValue !== 'string') {
        throw new Error(`${label}.${targetName} 必须是环境变量引用`);
      }
      const trimmedValue = sourceValue.trim();
      const placeholder = trimmedValue.match(ENV_REFERENCE_PATTERN);
      const environmentName = placeholder?.[1] ?? trimmedValue;
      if (!ENV_NAME_PATTERN.test(environmentName)) {
        throw new Error(
          `${label}.${targetName} 只能填写宿主环境变量名或 \${ENV_NAME} 占位符`,
        );
      }
      return [targetName, environmentName];
    }),
  );
};

const toPluginId = (serverName: string): string => {
  const id = serverName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return id || 'mcp-service';
};

/** 兼容完整插件对象与常见的单服务 mcpServers JSON。 */
export const parseMcpJson = (value: string): McpPluginConfig => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('MCP 配置必须是合法的 JSON');
  }

  const root = asObject(parsed, 'MCP 配置');
  let connection = root;
  let serverName = optionalString(root.serverName, 'serverName');

  if (root.mcpServers !== undefined) {
    const servers = Object.entries(asObject(root.mcpServers, 'mcpServers'));
    if (servers.length !== 1) {
      throw new Error('每次只能配置一个 mcpServers 服务');
    }
    const [configuredServerName, configuredConnection] = servers[0]!;
    serverName = configuredServerName;
    connection = asObject(
      configuredConnection,
      `mcpServers.${configuredServerName}`,
    );
  }

  serverName ??= optionalString(connection.serverName, 'serverName');
  if (!serverName) throw new Error('MCP JSON 缺少服务名称');

  const url = optionalString(connection.url, 'url');
  const rawTransport = (
    optionalString(connection.transport, 'transport') ??
    optionalString(connection.type, 'type') ??
    ''
  )
    .replace(/[ _]/g, '-')
    .toLowerCase();
  const transport: 'stdio' | 'http' =
    url ||
    rawTransport === 'http' ||
    rawTransport === 'sse' ||
    rawTransport === 'streamable-http' ||
    rawTransport === 'streamablehttp'
      ? 'http'
      : 'stdio';
  const rawArgs = connection.args ?? [];
  if (
    !Array.isArray(rawArgs) ||
    rawArgs.some((argument) => typeof argument !== 'string')
  ) {
    throw new Error('args 必须是字符串数组');
  }
  const timeoutValue = connection.timeoutMs ?? root.timeoutMs ?? 30_000;
  if (typeof timeoutValue !== 'number') {
    throw new Error('timeoutMs 必须是数字');
  }
  const enabledValue = root.enabled ?? true;
  if (typeof enabledValue !== 'boolean') {
    throw new Error('enabled 必须是布尔值');
  }

  return {
    id: optionalString(root.id, 'id') ?? toPluginId(serverName),
    name: optionalString(root.name, 'name') ?? serverName,
    description:
      optionalString(root.description, 'description') ??
      `通过 ${serverName} 提供 MCP 工具`,
    type: 'mcp',
    system: false,
    enabled: enabledValue,
    serverName,
    transport,
    command: optionalString(connection.command, 'command'),
    args: rawArgs as string[],
    cwd: optionalString(connection.cwd, 'cwd'),
    envVars: normalizeEnvironmentMap(
      connection.envVars ?? connection.env,
      'env',
    ),
    url,
    headerEnv: normalizeEnvironmentMap(
      connection.headerEnv ?? connection.headers,
      'headers',
    ),
    timeoutMs: timeoutValue,
  };
};

const formatEnvironmentMap = (mapping: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(mapping).map(([name, environmentName]) => [
      name,
      '${' + environmentName + '}',
    ]),
  );

export const formatMcpJson = (plugin: McpPluginConfig): string => {
  const connection =
    plugin.transport === 'stdio'
      ? {
          type: 'stdio',
          command: plugin.command,
          args: plugin.args,
          ...(plugin.cwd ? { cwd: plugin.cwd } : {}),
          ...(Object.keys(plugin.envVars).length > 0
            ? { env: formatEnvironmentMap(plugin.envVars) }
            : {}),
          timeoutMs: plugin.timeoutMs,
        }
      : {
          type: 'streamable_http',
          url: plugin.url,
          ...(Object.keys(plugin.headerEnv).length > 0
            ? { headers: formatEnvironmentMap(plugin.headerEnv) }
            : {}),
          timeoutMs: plugin.timeoutMs,
        };

  return JSON.stringify(
    {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      enabled: plugin.enabled,
      mcpServers: { [plugin.serverName]: connection },
    },
    null,
    2,
  );
};
