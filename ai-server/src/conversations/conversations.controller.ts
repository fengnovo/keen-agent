import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { ConversationsService } from './conversations.service.js';

/** Web 会话的 HTTP 路由层；校验和持久化逻辑集中在 Service 中。 */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  /** 返回供侧边栏使用的轻量会话摘要。 */
  @Get()
  list() {
    return this.conversationsService.list();
  }

  /** 返回指定会话及完整消息历史。 */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.conversationsService.get(id);
  }

  /** 创建一条持久化会话。 */
  @Post()
  create(@Body() body: unknown) {
    return this.conversationsService.create(body);
  }

  /** 修改会话标题、会话级模型或 Agent 能力开关。 */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.conversationsService.update(id, body);
  }

  /** 删除指定会话。 */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.conversationsService.remove(id);
  }
}
