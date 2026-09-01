import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PLUGIN_CONFIG_FILE,
  loadPluginRegistry,
  pluginConfigSchema,
  savePluginRegistry,
  type PluginConfig,
  type PluginRegistry,
} from '@keen-agent/ai-agent/plugin-config';
import {
  testPlugin,
  type PluginTestResult,
} from '@keen-agent/ai-agent/plugin-runtime';
import { z } from 'zod';

const enabledSchema = z.object({ enabled: z.boolean() });

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
    return testPlugin(await this.get(id));
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
