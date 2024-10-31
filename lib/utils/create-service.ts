import * as fs from 'fs/promises';
import * as path from 'path';
import { prettier } from './formatting';
import { toCamelCase, toKebabCase, toPascalCase } from './convert-string-cases';
import { formatTypeScriptCode } from './format-typescript-code';

export async function createService(
  libraryPath: string,
  tableName: string,
  fields: { name: string; type: string }[],
) {
  const servicePath = path.join(libraryPath, toKebabCase(tableName));
  await fs.mkdir(servicePath, { recursive: true });

  const fieldsForSearch = fields
    .filter((field) => field.type === 'varchar')
    .map((field) => field.name);

  const serviceContent = `
import { PaginationDTO, PaginationService } from '@hedhog/pagination';
import { PrismaService } from '@hedhog/prisma';
import {
  BadRequestException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { DeleteDTO } from './dto/delete.dto';
import { UpdateDTO } from './dto/update.dto';

@Injectable()
export class ${toPascalCase(tableName)}Service {
  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => PaginationService))
    private readonly paginationService: PaginationService,
  ) {}

  async get(paginationParams: PaginationDTO) {
    const OR: any[] = ${
      fieldsForSearch.length > 0
        ? `[${fieldsForSearch
            .map(
              (field) => `
      {
        ${field}: { contains: paginationParams.search, mode: 'insensitive' },
      }
    `,
            )
            .join(', ')}]`
        : '[]'
    };

    if (!isNaN(+paginationParams.search)) {
      OR.push({ id: { equals: +paginationParams.search } });
    }

    return this.paginationService.paginate(
      this.prismaService.${tableName},
      paginationParams,
      {
        where: {
          OR,
        },
      },
    );
  }

  async getById(${toCamelCase(tableName)}Id: number) {
    return this.prismaService.${tableName}.findUnique({
      where: { id: ${toCamelCase(tableName)}Id },
    });
  }

  async create(data: CreateDTO) {
    return this.prismaService.${tableName}.create({
      data,
    });
  }

  async update({ id, data }: { id: number; data: UpdateDTO }) {
    return this.prismaService.${tableName}.update({
      where: { id },
      data,
    });
  }

  async delete({ ids }: DeleteDTO) {
    if (ids == undefined || ids == null) {
      throw new BadRequestException(
        'You must select at least one item to delete.',
      );
    }

    return this.prismaService.${tableName}.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }
}
  `.trim();

  const serviceFilePath = path.join(
    servicePath,
    `${toKebabCase(tableName)}.service.ts`,
  );
  await fs.writeFile(
    serviceFilePath,
    await formatTypeScriptCode(serviceContent),
  );
}
