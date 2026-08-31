import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import { ModelsService } from './models.service.js';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  list() {
    return this.modelsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.modelsService.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.modelsService.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.modelsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.modelsService.remove(id);
  }

  @Patch(':id/active')
  activate(@Param('id') id: string) {
    return this.modelsService.activate(id);
  }
}
