import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  PLUGIN_CONFIG_FILE,
  loadPluginRegistry,
  pluginConfigSchema,
  savePluginRegistry,
  type PluginConfig,
  type PluginRegistry,
  type SkillPluginConfig,
} from '@keen-agent/ai-agent/plugin-config';
import {
  AI_AGENT_ROOT,
  REPOSITORY_ROOT,
  SKILLS_ROOT,
} from '@keen-agent/ai-agent/config';
import {
  loadSkill,
  testPlugin,
  type PluginTestResult,
} from '@keen-agent/ai-agent/plugin-runtime';
import { z } from 'zod';

const enabledSchema = z.object({ enabled: z.boolean() });
const installSkillsSchema = z.object({
  runner: z.enum(['npx', 'uvx']),
  args: z
    .array(z.string().min(1).max(2_048))
    .min(1)
    .max(40),
});
const SKILL_INSTALL_TIMEOUT_MS = 180_000;
const MAX_INSTALL_OUTPUT_LENGTH = 60_000;
const SKILL_SEARCH_ROOTS = [
  SKILLS_ROOT,
  join(AI_AGENT_ROOT, '.agents', 'skills'),
  join(AI_AGENT_ROOT, '.codex', 'skills'),
  join(AI_AGENT_ROOT, '.claude', 'skills'),
  join(AI_AGENT_ROOT, 'skills'),
];

interface DiscoveredSkill {
  realPath: string;
  configuredPath: string;
}

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

@Injectable()
export class PluginsService {
  private readonly filePath =
    process.env.PLUGIN_CONFIG_PATH?.trim() || PLUGIN_CONFIG_FILE;

  /** 插件写入与模型注册表一样串行化，避免多个管理请求覆盖彼此。 */
  private mutationQueue: Promise<void> = Promise.resolve();

  async list(): Promise<PluginRegistry> {
    await this.mutationQueue;
    return (await loadPluginRegistry(this.filePath)).registry;
  }

  async get(id: string): Promise<PluginConfig> {
    const registry = await this.list();
    return this.findOrThrow(registry, id);
  }

  create(payload: unknown): Promise<PluginRegistry> {
    const plugin = this.parsePlugin(payload);

    if (plugin.system || (plugin.type !== 'mcp' && plugin.type !== 'skill')) {
      throw new BadRequestException('管理页只能新增 MCP 或 Skill 插件');
    }

    return this.mutate((registry) => {
      if (registry.plugins.some((item) => item.id === plugin.id)) {
        throw new ConflictException(`插件 id 已存在：${plugin.id}`);
      }
      if (
        plugin.type === 'mcp' &&
        registry.plugins.some(
          (item) =>
            item.type === 'mcp' && item.serverName === plugin.serverName,
        )
      ) {
        throw new ConflictException(
          `MCP 服务名称已存在：${plugin.serverName}`,
        );
      }

      return { ...registry, plugins: [...registry.plugins, plugin] };
    });
  }

  update(id: string, payload: unknown): Promise<PluginRegistry> {
    const plugin = this.parsePlugin(payload);

    return this.mutate((registry) => {
      const current = this.findOrThrow(registry, id);
      if (current.system) {
        throw new BadRequestException('系统插件只能启用或停用，不能修改定义');
      }
      if (plugin.system || (plugin.type !== 'mcp' && plugin.type !== 'skill')) {
        throw new BadRequestException('只能保存 MCP 或 Skill 插件');
      }
      if (
        id !== plugin.id &&
        registry.plugins.some((item) => item.id === plugin.id)
      ) {
        throw new ConflictException(`插件 id 已存在：${plugin.id}`);
      }
      if (
        plugin.type === 'mcp' &&
        registry.plugins.some(
          (item) =>
            item.id !== id &&
            item.type === 'mcp' &&
            item.serverName === plugin.serverName,
        )
      ) {
        throw new ConflictException(
          `MCP 服务名称已存在：${plugin.serverName}`,
        );
      }

      return {
        ...registry,
        plugins: registry.plugins.map((item) =>
          item.id === id ? plugin : item,
        ),
      };
    });
  }

  setEnabled(id: string, payload: unknown): Promise<PluginRegistry> {
    const result = enabledSchema.safeParse(payload);
    if (!result.success) {
      throw new BadRequestException('enabled 必须是布尔值');
    }

    return this.mutate((registry) => {
      this.findOrThrow(registry, id);
      return {
        ...registry,
        plugins: registry.plugins.map((plugin) =>
          plugin.id === id
            ? { ...plugin, enabled: result.data.enabled }
            : plugin,
        ),
      } as PluginRegistry;
    });
  }

  remove(id: string): Promise<PluginRegistry> {
    return this.mutate((registry) => {
      const plugin = this.findOrThrow(registry, id);
      if (plugin.system) {
        throw new BadRequestException('系统插件不能删除');
      }

      return {
        ...registry,
        plugins: registry.plugins.filter((item) => item.id !== id),
      };
    });
  }

  async test(id: string): Promise<PluginTestResult> {
    try {
      return await testPlugin(await this.get(id));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '插件测试失败',
      );
    }
  }

  /** 测试编辑器中的 MCP 草稿；成功或失败都不会写入注册表。 */
  async testConfig(payload: unknown): Promise<PluginTestResult> {
    const plugin = this.parsePlugin(payload);
    if (plugin.type !== 'mcp' || plugin.system) {
      throw new BadRequestException('只能测试 MCP 配置');
    }

    try {
      return await testPlugin(plugin);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'MCP 连接测试失败',
      );
    }
  }

  /**
   * 包执行器通过参数数组启动而不经过 shell。执行后只扫描 ai-agent 下的约定
   * Skill 目录，并把本次新增且符合规范的 Skill 自动加入注册表。
   */
  async installSkills(payload: unknown): Promise<SkillInstallResult> {
    const parsed = installSkillsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Skill 安装命令校验失败',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'root',
          message: issue.message,
        })),
      });
    }

    const before = await this.discoverSkills();
    const output = await this.runSkillInstaller(
      parsed.data.runner,
      parsed.data.args,
    );
    const after = await this.discoverSkills();
    const candidates = [...after.values()].filter(
      (skill) => !before.has(skill.realPath),
    );
    const loadedSkills = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const skill = await loadSkill({
            id: 'install-preview',
            name: '安装预览',
            description: '安装预览',
            type: 'skill',
            system: false,
            enabled: true,
            path: candidate.configuredPath,
          });
          return { candidate, skill };
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error
              ? `安装命令已完成，但新 Skill 校验失败：${error.message}`
              : '安装命令已完成，但新 Skill 校验失败',
          );
        }
      }),
    );

    if (loadedSkills.length === 0) {
      return {
        message:
          '安装命令执行成功，但未在 ai-agent 的 Skills 目录中检测到新增内容',
        output,
        installed: [],
        registry: await this.list(),
      };
    }

    const installed: SkillInstallResult['installed'] = [];
    const registry = await this.mutate((current) => {
      const plugins = [...current.plugins];
      const usedIds = new Set(plugins.map((plugin) => plugin.id));

      for (const { candidate, skill } of loadedSkills) {
        const alreadyRegistered = plugins.some(
          (plugin) =>
            plugin.type === 'skill' &&
            plugin.path === candidate.configuredPath,
        );
        if (alreadyRegistered) continue;

        const id = this.createUniqueSkillId(skill.name, usedIds);
        usedIds.add(id);
        const plugin: SkillPluginConfig = {
          id,
          name: skill.name,
          description: skill.description,
          type: 'skill',
          system: false,
          enabled: true,
          path: candidate.configuredPath,
        };
        plugins.push(plugin);
        installed.push({
          id,
          name: skill.name,
          description: skill.description,
          path: candidate.configuredPath,
        });
      }

      return { ...current, plugins };
    });

    return {
      message: `安装命令执行成功，已注册 ${installed.length} 个 Skill`,
      output,
      installed,
      registry,
    };
  }

  private parsePlugin(payload: unknown): PluginConfig {
    const result = pluginConfigSchema.safeParse(payload);

    if (!result.success) {
      throw new BadRequestException({
        message: '插件配置校验失败',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'root',
          message: issue.message,
        })),
      });
    }

    return result.data;
  }

  private findOrThrow(registry: PluginRegistry, id: string): PluginConfig {
    const plugin = registry.plugins.find((item) => item.id === id);
    if (!plugin) throw new NotFoundException(`找不到插件：${id}`);
    return plugin;
  }

  private async runSkillInstaller(
    runner: 'npx' | 'uvx',
    args: string[],
  ): Promise<string> {
    const result = await new Promise<{
      exitCode: number | null;
      output: string;
      timedOut: boolean;
    }>((resolveCommand, rejectCommand) => {
      const useProcessGroup = process.platform !== 'win32';
      const child = spawn(runner, args, {
        cwd: AI_AGENT_ROOT,
        env: {
          ...process.env,
          CI: '1',
          NO_COLOR: '1',
          // 仓库 devEngines 固定为 pnpm；这里只对管理员主动启动的 npx
          // 子进程关闭包管理器不匹配的硬失败，避免安装器在执行前被 npm 拦截。
          npm_config_force: 'true',
          npm_config_yes: 'true',
        },
        detached: useProcessGroup,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let timedOut = false;
      let settled = false;

      const appendOutput = (chunk: Buffer) => {
        if (output.length >= MAX_INSTALL_OUTPUT_LENGTH) return;
        output += chunk
          .toString('utf8')
          .slice(0, MAX_INSTALL_OUTPUT_LENGTH - output.length);
      };
      child.stdout.on('data', appendOutput);
      child.stderr.on('data', appendOutput);

      const terminate = (signal: NodeJS.Signals) => {
        try {
          if (useProcessGroup && child.pid) {
            process.kill(-child.pid, signal);
          } else {
            child.kill(signal);
          }
        } catch {
          child.kill(signal);
        }
      };

      let forceKillTimeout: NodeJS.Timeout | undefined;

      const timeout = setTimeout(() => {
        timedOut = true;
        terminate('SIGTERM');
        forceKillTimeout = setTimeout(() => terminate('SIGKILL'), 2_000);
      }, SKILL_INSTALL_TIMEOUT_MS);

      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forceKillTimeout) clearTimeout(forceKillTimeout);
        rejectCommand(error);
      });
      child.once('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forceKillTimeout) clearTimeout(forceKillTimeout);
        resolveCommand({ exitCode, output, timedOut });
      });
    }).catch((error: unknown) => {
      throw new BadRequestException(
        error instanceof Error
          ? `无法启动 ${runner}：${error.message}`
          : `无法启动 ${runner}`,
      );
    });

    const output = this.cleanCommandOutput(result.output);
    if (result.timedOut) {
      throw new BadRequestException(
        `${runner} 安装超过 ${SKILL_INSTALL_TIMEOUT_MS / 1_000} 秒，已终止${output ? `：${output.slice(-1_000)}` : ''}`,
      );
    }
    if (result.exitCode !== 0) {
      throw new BadRequestException(
        `${runner} 安装失败（退出码 ${result.exitCode ?? '未知'}）${output ? `：${output.slice(-1_500)}` : ''}`,
      );
    }

    return output;
  }

  private cleanCommandOutput(output: string): string {
    return output
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\r/g, '')
      .trim();
  }

  private async discoverSkills(): Promise<Map<string, DiscoveredSkill>> {
    const discovered = new Map<string, DiscoveredSkill>();
    const visitedDirectories = new Set<string>();

    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > 4) return;

      let canonicalDirectory: string;
      try {
        canonicalDirectory = await realpath(directory);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return;
        }
        throw error;
      }

      const relativeToAgent = relative(AI_AGENT_ROOT, canonicalDirectory);
      if (
        relativeToAgent === '..' ||
        relativeToAgent.startsWith(`..${sep}`)
      ) {
        return;
      }
      if (visitedDirectories.has(canonicalDirectory)) return;
      visitedDirectories.add(canonicalDirectory);

      const entries = await readdir(directory, { withFileTypes: true });
      if (
        entries.some(
          (entry) => entry.isFile() && entry.name === 'SKILL.md',
        )
      ) {
        discovered.set(canonicalDirectory, {
          realPath: canonicalDirectory,
          configuredPath: relative(REPOSITORY_ROOT, directory).replaceAll(
            '\\',
            '/',
          ),
        });
        return;
      }

      for (const entry of entries) {
        if (
          entry.name === '.git' ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__'
        ) {
          continue;
        }
        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath, depth + 1);
        } else if (entry.isSymbolicLink()) {
          try {
            if ((await stat(entryPath)).isDirectory()) {
              await visit(entryPath, depth + 1);
            }
          } catch {
            // 安装器留下的断链不应阻止其他 Skill 被发现。
          }
        }
      }
    };

    for (const root of SKILL_SEARCH_ROOTS) {
      await visit(root, 0);
    }
    return discovered;
  }

  private createUniqueSkillId(name: string, usedIds: Set<string>): string {
    const normalized = name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56);
    const base = normalized || 'installed-skill';
    let id = base;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${base.slice(0, 56 - String(suffix).length)}-${suffix}`;
      suffix += 1;
    }
    return id;
  }

  private mutate(
    operation: (registry: PluginRegistry) => PluginRegistry,
  ): Promise<PluginRegistry> {
    const result = this.mutationQueue.then(async () => {
      const registry = (await loadPluginRegistry(this.filePath)).registry;
      const updatedRegistry = operation(registry);

      await savePluginRegistry(updatedRegistry, this.filePath);
      return updatedRegistry;
    });

    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
