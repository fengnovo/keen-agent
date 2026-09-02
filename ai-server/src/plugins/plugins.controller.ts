import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import { PluginsService } from './plugins.service.js';

/** 插件管理 HTTP 层；配置校验、系统插件保护与连接测试都由 Service 负责。 */
@Controller('plugins')
export class PluginsController {
  constructor(private readonly pluginsService: PluginsService) {}

  @Get()
  list() {
    return this.pluginsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.pluginsService.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.pluginsService.create(body);
  }

  @Post('test-config')
  @HttpCode(200)
  testConfig(@Body() body: unknown) {
    return this.pluginsService.testConfig(body);
  }

  @Post('install-skills')
  @HttpCode(200)
  installSkills(@Body() body: unknown) {
    return this.pluginsService.installSkills(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.pluginsService.update(id, body);
  }

  @Patch(':id/enabled')
  setEnabled(@Param('id') id: string, @Body() body: unknown) {
    return this.pluginsService.setEnabled(id, body);
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id') id: string) {
    return this.pluginsService.test(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pluginsService.remove(id);
  }
}
