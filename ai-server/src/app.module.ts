import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { ChatController } from './chat/chat.controller.js';
import { ChatService } from './chat/chat.service.js';
import { ConversationsController } from './conversations/conversations.controller.js';
import { ConversationsService } from './conversations/conversations.service.js';
import { ModelsController } from './models/models.controller.js';
import { ModelsService } from './models/models.service.js';
import { PluginsController } from './plugins/plugins.controller.js';
import { PluginsService } from './plugins/plugins.service.js';
import { ArtifactsController } from './artifacts/artifacts.controller.js';
import { ArtifactsService } from './artifacts/artifacts.service.js';
import { PreviewsController } from './previews/previews.controller.js';
import { PreviewsService } from './previews/previews.service.js';

/**
 * AI Server 根模块：模型配置、Web 会话和聊天流共享同一个 ModelsService。
 */
@Module({
  controllers: [
    HealthController,
    ModelsController,
    PluginsController,
    ConversationsController,
    ChatController,
    ArtifactsController,
    PreviewsController,
  ],
  providers: [
    ModelsService,
    PluginsService,
    ConversationsService,
    ChatService,
    ArtifactsService,
    PreviewsService,
  ],
})
export class AppModule {}
