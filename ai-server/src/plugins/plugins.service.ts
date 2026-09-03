import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import net from 'node:net';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
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

/**
 * 常见本地代理的混合/HTTP 端口（Clash Verge 7897、Clash 7890/7891、
 * V2Ray/其他 1087/1080/8888）。安装器要从 GitHub 克隆仓库，宿主机直连
 * 超时时自动复用本机已运行的代理。
 */
const LOCAL_PROXY_CANDIDATE_PORTS = [7897, 7890, 1087, 7891, 1080, 8888];

const probeLocalProxyPort = (port: number): Promise<boolean> =>
  new Promise((resolveProbe) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (available: boolean) => {
      socket.destroy();
      resolveProbe(available);
    };
    socket.setTimeout(300);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

/**
 * 返回需要注入安装器子进程的代理环境变量。
 * - 服务进程已显式配置代理（HTTPS_PROXY 等）时返回空对象，原样透传；
 * - 否则探测常见本地代理端口，命中则同时设置大小写形式，覆盖 git(libcurl)、
 *   npm/npx 与 uvx 对代理变量名的差异；
 * - 本机回环地址加入 NO_PROXY，避免本地请求绕代理。
 */
const resolveInstallerProxyEnv = async (): Promise<Record<string, string>> => {
  const configured =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (configured?.trim()) return {};

  for (const port of LOCAL_PROXY_CANDIDATE_PORTS) {
    if (await probeLocalProxyPort(port)) {
      const proxy = `http://127.0.0.1:${port}`;
      return {
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        http_proxy: proxy,
        https_proxy: proxy,
        ALL_PROXY: proxy,
        all_proxy: proxy,
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      };
    }
  }

  return {};
};

/**
 * skills CLI 缺少确认参数时会进入交互式多选菜单；spawn 没有 TTY（stdin 接
 * /dev/null）会让它读到 EOF 后静默退出、不落地任何文件。这里为 `skills add`
 * 自动补齐非交互参数：
 * - 追加 -y 跳过确认提示（含安全评估确认）；
 * - 未显式指定目标时安装到项目级通用目录 .agents/skills（本服务的扫描目录）。
 * 用户显式传入 --agent/--all/--global 时保持其选择不变。
 */
const normalizeSkillInstallArgs = (rawArgs: string[]): string[] => {
  const skillsIndex = rawArgs.findIndex(
    (arg) => arg === 'skills' || /^skills(@[\w.-]+)?$/.test(arg),
  );
  if (skillsIndex < 0) return rawArgs;
  const subcommand = rawArgs[skillsIndex + 1];
  if (subcommand !== 'add' && subcommand !== 'a') return rawArgs;

  const flagName = (arg: string) => arg.split('=')[0];
  const hasFlag = (...flags: string[]) =>
    rawArgs.some((arg) => flags.includes(flagName(arg)));

  const normalized = [...rawArgs];
  if (!hasFlag('-y', '--yes')) normalized.push('-y');
  if (!hasFlag('-a', '--agent', '--all', '-g', '--global')) {
    normalized.push('-a', 'universal');
  }
  return normalized;
};
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
      normalizeSkillInstallArgs(parsed.data.args),
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

    // 安装器只会写入它认识的生态目录（.agents/skills 等）；这里统一移动到
    // 项目约定的 .skills 根目录，注册表只暴露 .skills 下的路径。
    const claimedTargets = new Set<string>();
    const relocatedSkills = await Promise.all(
      loadedSkills.map(async ({ candidate, skill }) => ({
        candidate: await this.relocateInstalledSkill(
          candidate,
          skill.name,
          before,
          claimedTargets,
        ),
        skill,
      })),
    );

    const installed: SkillInstallResult['installed'] = [];
    let upgradedCount = 0;
    const registry = await this.mutate((current) => {
      const plugins = [...current.plugins];
      const usedIds = new Set(plugins.map((plugin) => plugin.id));

      for (const { candidate, skill } of relocatedSkills) {
        const existing = plugins.find(
          (plugin) =>
            plugin.type === 'skill' &&
            plugin.path === candidate.configuredPath,
        );
        if (existing) {
          // 同路径重新安装（升级）：刷新名称与描述，不重复注册。
          existing.name = skill.name;
          existing.description = skill.description;
          upgradedCount += 1;
          continue;
        }

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
      message:
        installed.length > 0
          ? `安装命令执行成功，已注册 ${installed.length} 个 Skill（统一保存到 .skills 目录）`
          : `安装命令执行成功，已更新 ${upgradedCount} 个 Skill`,
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
    // 安装器内部会用 git 从 GitHub 克隆仓库；宿主机直连不稳定时自动复用本机代理。
    const installerProxyEnv = await resolveInstallerProxyEnv();
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
          ...installerProxyEnv,
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
      const looksLikeNetworkFailure =
        /Failed to connect to|Couldn't connect|curl 28|Could not resolve host|Failed to clone|Connection timed out|timed out/i.test(
          output,
        );
      const networkHint = looksLikeNetworkFailure
        ? '。克隆 GitHub 仓库失败，通常是宿主机无法直连 github.com：请开启 Clash 等本机代理后重试（服务端会自动探测并复用 7897/7890 等端口），或在启动 ai-server 时设置 HTTPS_PROXY 环境变量'
        : '';
      throw new BadRequestException(
        `${runner} 安装失败（退出码 ${result.exitCode ?? '未知'}）${networkHint}${output ? `：${output.slice(-1_500)}` : ''}`,
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

  /** 读取 Skill 目录下 SKILL.md frontmatter 中的 name（仅用于同名判断，失败返回 undefined）。 */
  private async readSkillFrontmatterName(
    directory: string,
  ): Promise<string | undefined> {
    try {
      const content = await readFile(join(directory, 'SKILL.md'), 'utf8');
      const frontmatter = content.split(/^---\s*$/m)[1];
      const match = (frontmatter ?? content).match(
        /^name:\s*['"]?([^'"\r\n]+)['"]?\s*$/m,
      );
      return match?.[1]?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 把本次安装新增的 Skill 目录移动到项目约定的 .skills 根目录。
   * - 已在 .skills 内则原样返回；
   * - 目标已存在且是同一个 Skill（frontmatter name 相同）时删除旧目录后覆盖，
   *   支持重新安装/升级；目标是其他 Skill 或系统内置内容时改用带后缀的目录名，
   *   绝不误删；
   * - 优先 rename（同盘原子移动），跨设备或失败时退化为 cp（解引用符号链接）后
   *   删除源目录。
   */
  private async relocateInstalledSkill(
    candidate: DiscoveredSkill,
    skillName: string,
    before: Map<string, DiscoveredSkill>,
    claimedTargets: Set<string>,
  ): Promise<DiscoveredSkill> {
    await mkdir(SKILLS_ROOT, { recursive: true });
    const skillsRootReal = await realpath(SKILLS_ROOT);

    const relativeToSkills = relative(skillsRootReal, candidate.realPath);
    if (
      relativeToSkills &&
      !isAbsolute(relativeToSkills) &&
      !relativeToSkills.startsWith('..')
    ) {
      claimedTargets.add(candidate.realPath);
      return candidate;
    }

    const pathExists = async (path: string): Promise<boolean> => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    };

    const baseName = basename(candidate.realPath);
    let suffix = 0;
    let target = join(SKILLS_ROOT, baseName);
    for (;;) {
      const dirName = suffix === 0 ? baseName : `${baseName}-${suffix}`;
      target = join(SKILLS_ROOT, dirName);
      const targetReal = await realpath(target).catch(() => target);
      const exists = await pathExists(target);
      const claimedByBatch = claimedTargets.has(targetReal);

      if (!exists || claimedByBatch) {
        if (!claimedByBatch) break;
        suffix += 1;
        continue;
      }

      if (!before.has(targetReal)) {
        // 安装前不存在：上次失败留下的残留，可安全覆盖。
        break;
      }

      // 安装前已存在：同名 Skill 覆盖升级，疑似其他内容则避让。
      const existingName = await this.readSkillFrontmatterName(target);
      if (existingName === skillName) break;
      suffix += 1;
    }

    const targetReal = await realpath(target).catch(() => target);
    claimedTargets.add(targetReal);

    if (await pathExists(target)) {
      await rm(target, { recursive: true, force: true });
    }
    try {
      await rename(candidate.realPath, target);
    } catch {
      await cp(candidate.realPath, target, { recursive: true });
      await rm(candidate.realPath, { recursive: true, force: true });
    }

    const relocatedReal = await realpath(target);
    return {
      realPath: relocatedReal,
      configuredPath: relative(REPOSITORY_ROOT, target).replaceAll(
        '\\',
        '/',
      ),
    };
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
