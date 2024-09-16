import * as fs from 'fs/promises';
import * as path from 'path';
import { capitalize } from './formatting';

export async function createController(
  libraryPath: string,
  libraryName: string,
) {
  const controllerPath = path.join(libraryPath, 'src');
  await fs.mkdir(controllerPath, { recursive: true });

  const controllerContent = `
import { AuthGuard } from '@hedhog/auth';
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
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { DeleteDTO } from './dto/delete.dto';
import { UpdateDTO } from './dto/update.dto';
import { ${capitalize(libraryName)}Service } from './${libraryName}.service';

@Controller('${libraryName}s')
export class ${capitalize(libraryName)}Controller {
  constructor(
    @Inject(forwardRef(() => ${capitalize(libraryName)}Service))
    private readonly ${libraryName}Service: ${capitalize(libraryName)}Service,
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  async get(@Pagination() paginationParams) {
    return this.${libraryName}Service.get(paginationParams);
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.${libraryName}Service.getById(id);
  }

  @UseGuards(AuthGuard)
  @Post()
  create(@Body() data: CreateDTO) {
    return this.${libraryName}Service.create(data);
  }

  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateDTO,
  ) {
    return this.${libraryName}Service.update({
      id,
      data,
    });
  }

  @UseGuards(AuthGuard)
  @Delete()
  async delete(@Body() data: DeleteDTO) {
    return this.${libraryName}Service.delete(data);
  }
}
  `.trim();

  await fs.writeFile(
    path.join(controllerPath, `${libraryName}.controller.ts`),
    controllerContent,
  );
}
