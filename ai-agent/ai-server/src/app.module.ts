import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { ModelsController } from './models/models.controller.js';
import { ModelsService } from './models/models.service.js';

@Module({
  controllers: [HealthController, ModelsController],
  providers: [ModelsService],
})
export class AppModule {}
