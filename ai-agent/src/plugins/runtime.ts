import type {
  McpPluginConfig,
  PluginConfig,
  PluginRegistry,
  SkillPluginConfig,
} from '../config/plugin-config.ts';
import { systemToolCatalog, type SystemTool } from './builtin-tools.ts';
import {
  loadMcpTools,
  testMcpPlugin,
  type McpTools,
} from './mcp-loader.ts';
import { loadSkill, type LoadedSkill } from './skill-loader.ts';

export { loadSkill } from './skill-loader.ts';
export type { LoadedSkill, LoadedSkillFile } from './skill-loader.ts';

export interface ResolvedPlugins {
  /** DeepAgent 核心插件关闭时，调用方应退回普通 LangChain Agent。 */
  deepAgentEnabled: boolean;
  tools: SystemTool[];
  mcpTools: McpTools;
  skills: LoadedSkill[];
  enabledPluginNames: string[];
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
      tools: [],
      mcpTools: [],
      skills: [],
      enabledPluginNames: [],
      close: async () => undefined,
    };
  }

  const enabledPlugins = registry.plugins.filter((plugin) => plugin.enabled);
  const deepAgentEnabled = enabledPlugins.some(
    (plugin) =>
      plugin.type === 'builtin' && plugin.implementation === 'deepagent',
  );
  const toolPlugins = enabledPlugins.filter(
    (plugin) => plugin.type === 'tool',
  );
  const mcpPlugins = enabledPlugins.filter(
    (plugin): plugin is McpPluginConfig => plugin.type === 'mcp',
  );
  const skillPlugins = enabledPlugins.filter(
    (plugin): plugin is SkillPluginConfig => plugin.type === 'skill',
  );
  const tools = toolPlugins.map(
    (plugin) => systemToolCatalog[plugin.implementation],
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
  return {
    deepAgentEnabled,
    tools,
    mcpTools: mcpRuntime.tools,
    skills,
    enabledPluginNames: enabledPlugins.map((plugin) => plugin.name),
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

  const names =
    plugin.type === 'builtin' ? plugin.capabilities : plugin.toolNames;
  return {
    message: `系统插件可用，共包含 ${names.length} 项能力`,
    tools: names,
  };
};
