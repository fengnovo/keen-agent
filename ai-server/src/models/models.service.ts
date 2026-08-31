import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MODEL_CONFIG_FILE,
  loadModelRegistry,
  modelConfigSchema,
  saveModelRegistry,
  withActiveModel,
  type ModelConfig,
  type ModelRegistry,
} from '@keen-agent/ai-agent/model-config';

@Injectable()
export class ModelsService {
  private readonly filePath =
    process.env.MODEL_CONFIG_PATH?.trim() || MODEL_CONFIG_FILE;

  /** 所有写操作串行执行，防止并发请求互相覆盖。 */
  private mutationQueue: Promise<void> = Promise.resolve();

  async list(): Promise<ModelRegistry> {
    await this.mutationQueue;
    return (await loadModelRegistry(this.filePath)).registry;
  }

  async get(id: string): Promise<ModelConfig> {
    const registry = await this.list();
    return this.findOrThrow(registry, id);
  }

  create(payload: unknown): Promise<ModelRegistry> {
    const model = this.parseModel(payload);

    return this.mutate((registry) => {
      if (registry.models.some((item) => item.id === model.id)) {
        throw new ConflictException(`模型 id 已存在：${model.id}`);
      }

      return {
        ...registry,
        models: [...registry.models, model],
      };
    });
  }

  update(id: string, payload: unknown): Promise<ModelRegistry> {
    const model = this.parseModel(payload);

    return this.mutate((registry) => {
      this.findOrThrow(registry, id);

      if (
        id !== model.id &&
        registry.models.some((item) => item.id === model.id)
      ) {
        throw new ConflictException(`模型 id 已存在：${model.id}`);
      }

      return {
        ...registry,
        activeModelId:
          registry.activeModelId === id ? model.id : registry.activeModelId,
        models: registry.models.map((item) =>
          item.id === id ? model : item,
        ),
      };
    });
  }

  remove(id: string): Promise<ModelRegistry> {
    return this.mutate((registry) => {
      this.findOrThrow(registry, id);

      if (registry.models.length === 1) {
        throw new BadRequestException('至少需要保留一个模型');
      }

      const models = registry.models.filter((item) => item.id !== id);

      return {
        ...registry,
        activeModelId:
          registry.activeModelId === id
            ? (models[0]?.id ?? registry.activeModelId)
            : registry.activeModelId,
        models,
      };
    });
  }

  activate(id: string): Promise<ModelRegistry> {
    return this.mutate((registry) => {
      this.findOrThrow(registry, id);
      return withActiveModel(registry, id);
    });
  }

  private parseModel(payload: unknown): ModelConfig {
    const result = modelConfigSchema.safeParse(payload);

    if (!result.success) {
      throw new BadRequestException({
        message: '模型配置校验失败',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'root',
          message: issue.message,
        })),
      });
    }

    return result.data;
  }

  private findOrThrow(registry: ModelRegistry, id: string): ModelConfig {
    const model = registry.models.find((item) => item.id === id);

    if (!model) {
      throw new NotFoundException(`找不到模型：${id}`);
    }

    return model;
  }

  private mutate(
    operation: (registry: ModelRegistry) => ModelRegistry,
  ): Promise<ModelRegistry> {
    const result = this.mutationQueue.then(async () => {
      const registry = (await loadModelRegistry(this.filePath)).registry;
      const updatedRegistry = operation(registry);

      await saveModelRegistry(updatedRegistry, this.filePath);
      return updatedRegistry;
    });

    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
