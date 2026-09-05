import type {
  McpPluginConfig,
  PluginConfig,
  PluginRegistry,
  SkillPluginConfig,
} from '../config/plugin-config.ts';
import { systemToolCatalog, type SystemTool } from './builtin-tools.ts';
import { loadMcpTools, testMcpPlugin, type McpTools } from './mcp-loader.ts';
import { loadSkill, type LoadedSkill } from './skill-loader.ts';
import { DockerSandboxBackend } from '../sandbox/docker-sandbox.ts';

export { loadSkill } from './skill-loader.ts';
export type { LoadedSkill, LoadedSkillFile } from './skill-loader.ts';

export interface ResolvedPlugins {
  /** DeepAgent 核心插件关闭时，调用方应退回普通 LangChain Agent。 */
  deepAgentEnabled: boolean;
  /** 启用后由 Agent 层把 DeepAgent 文件后端切换为 Docker 沙箱。 */
  sandboxEnabled: boolean;
  tools: SystemTool[];
  mcpTools: McpTools;
  skills: LoadedSkill[];
  enabledPluginNames: string[];
  /** 可选插件初始化失败时保留本轮可用能力，并把原因交给 Agent 和 UI。 */
  warnings: string[];
  close: () => Promise<void>;
}

/**
 * 按注册表解析本轮 Agent 能力。会话关闭工具时不会连接 MCP、读取 Skill，
 * 也不会返回任何本地工具，避免“只靠提示词关闭工具”的假隔离。
 */
export const resolvePlugins = async (
  registry: PluginRegistry,
  toolsEnabled: boolean,
): Promise<ResolvedPlugins> => {
  if (!toolsEnabled) {
    return {
      deepAgentEnabled: false,
      sandboxEnabled: false,
      tools: [],
      mcpTools: [],
      skills: [],
      enabledPluginNames: [],
      warnings: [],
      close: async () => undefined,
    };
  }

  const enabledPlugins = registry.plugins.filter((plugin) => plugin.enabled);
  const deepAgentEnabled = enabledPlugins.some(
    (plugin) =>
      plugin.type === 'builtin' && plugin.implementation === 'deepagent',
  );
  const toolPlugins = enabledPlugins.filter((plugin) => plugin.type === 'tool');
  const mcpPlugins = enabledPlugins.filter(
    (plugin): plugin is McpPluginConfig => plugin.type === 'mcp',
  );
  const skillPlugins = enabledPlugins.filter(
    (plugin): plugin is SkillPluginConfig => plugin.type === 'skill',
  );
  const sandboxEnabled = toolPlugins.some(
    (plugin) => plugin.implementation === 'docker_sandbox',
  );
  const tools = toolPlugins.flatMap((plugin) =>
    Object.keys(systemToolCatalog).includes(plugin.implementation)
      ? [systemToolCatalog[plugin.implementation as keyof typeof systemToolCatalog]]
      : [],
  );
  const skills = await Promise.all(skillPlugins.map(loadSkill));
  const skillNames = new Set<string>();
  for (const skill of skills) {
    if (skillNames.has(skill.name)) {
      throw new Error(`Skill 名称重复：${skill.name}`);
    }
    skillNames.add(skill.name);
  }

  const mcpRuntime = await loadMcpTools(mcpPlugins);
  const failedMcpIds = new Set(
    mcpRuntime.failures.map((failure) => failure.pluginId),
  );
  return {
    deepAgentEnabled,
    sandboxEnabled,
    tools,
    mcpTools: mcpRuntime.tools,
    skills,
    enabledPluginNames: enabledPlugins
      .filter((plugin) => !failedMcpIds.has(plugin.id))
      .map((plugin) => plugin.name),
    warnings: mcpRuntime.failures.map((failure) => failure.message),
    close: mcpRuntime.close,
  };
};

export interface PluginTestResult {
  message: string;
  tools?: string[];
  skill?: Pick<LoadedSkill, 'name' | 'description' | 'filePath'> & {
    fileCount: number;
  };
}

/** 管理页测试使用与 Agent 相同的加载器，避免“测试能用、运行不能用”。 */
export const testPlugin = async (
  plugin: PluginConfig,
): Promise<PluginTestResult> => {
  if (plugin.type === 'skill') {
    const { name, description, filePath, files } = await loadSkill(plugin);
    return {
      message: `已读取 Skill：${name}，共装载 ${files.length} 个文件`,
      skill: { name, description, filePath, fileCount: files.length },
    };
  }

  if (plugin.type === 'mcp') {
    const tools = await testMcpPlugin(plugin);
    return {
      message: `MCP 连接成功，共发现 ${tools.length} 个工具`,
      tools,
    };
  }

  if (plugin.type === 'tool' && plugin.implementation === 'docker_sandbox') {
    const sandbox = await DockerSandboxBackend.create({}, []);
    try {
      const result = await sandbox.execute(
        'python --version && node --version',
      );
      if (result.exitCode !== 0) {
        throw new Error(result.output || 'Docker 沙箱命令执行失败');
      }
      return {
        message: `Docker 隔离执行器可用：${result.output.trim().replace(/\n/g, ' / ')}`,
        tools: plugin.toolNames,
      };
    } finally {
      await sandbox.close().catch(() => undefined);
    }
  }

  const names =
    plugin.type === 'builtin' ? plugin.capabilities : plugin.toolNames;
  return {
    message: `系统插件可用，共包含 ${names.length} 项能力`,
    tools: names,
  };
};
