import * as fs from 'fs/promises';
import * as path from 'path';
import { capitalize, prettier } from './formatting';

export async function createController(libraryPath: string, tableName: string) {
  const controllerPath = path.join(libraryPath, tableName);
  await fs.mkdir(controllerPath, { recursive: true });

  const controllerContent = `
import { Pagination } from '@hedhog/pagination';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  forwardRef,
} from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { DeleteDTO } from './dto/delete.dto';
import { UpdateDTO } from './dto/update.dto';
import { ${capitalize(tableName)}Service } from './${tableName}.service';
import { Role } from '@hedhog/admin';

@Role()
@Controller('${tableName}')
export class ${capitalize(tableName)}Controller {
  constructor(
    @Inject(forwardRef(() => ${capitalize(tableName)}Service))
    private readonly ${tableName}Service: ${capitalize(tableName)}Service,
  ) {}

  @Get()
  async get(@Pagination() paginationParams) {
    return this.${tableName}Service.get(paginationParams);
  }

  @Get(':id')
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.${tableName}Service.getById(id);
  }

  @Post()
  create(@Body() data: CreateDTO) {
    return this.${tableName}Service.create(data);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateDTO,
  ) {
    return this.${tableName}Service.update({
      id,
      data,
    });
  }

  @Delete()
  async delete(@Body() data: DeleteDTO) {
    return this.${tableName}Service.delete(data);
  }
}
  `.trim();

  const controllerFilePath = path.join(
    controllerPath,
    `${tableName}.controller.ts`,
  );
  await fs.writeFile(controllerFilePath, controllerContent);
  await prettier(controllerFilePath);
}
