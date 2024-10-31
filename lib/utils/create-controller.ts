import * as fs from 'fs/promises';
import * as path from 'path';
import { capitalize, prettier } from './formatting';
import { toCamelCase, toKebabCase, toPascalCase } from './convert-string-cases';

export async function createController(libraryPath: string, tableName: string) {
  const controllerPath = path.join(libraryPath, toKebabCase(tableName));
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
import { ${toPascalCase(tableName)}Service } from './${toKebabCase(tableName)}.service';
import { Role } from '@hedhog/admin';

@Role()
@Controller('${toKebabCase(tableName)}')
export class ${toPascalCase(tableName)}Controller {
  constructor(
    @Inject(forwardRef(() => ${toPascalCase(tableName)}Service))
    private readonly ${toCamelCase(tableName)}Service: ${toPascalCase(tableName)}Service,
  ) {}

  @Get()
  async get(@Pagination() paginationParams) {
    return this.${toCamelCase(tableName)}Service.get(paginationParams);
  }

  @Get(':id')
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.${toCamelCase(tableName)}Service.getById(id);
  }

  @Post()
  create(@Body() data: CreateDTO) {
    return this.${toCamelCase(tableName)}Service.create(data);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateDTO,
  ) {
    return this.${toCamelCase(tableName)}Service.update({
      id,
      data,
    });
  }

  @Delete()
  async delete(@Body() data: DeleteDTO) {
    return this.${toCamelCase(tableName)}Service.delete(data);
  }
}
  `.trim();

  const controllerFilePath = path.join(
    controllerPath,
    `${toKebabCase(tableName)}.controller.ts`,
  );
  await fs.writeFile(controllerFilePath, controllerContent);
  await prettier(controllerFilePath);
}
