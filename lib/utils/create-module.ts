import * as fs from 'fs/promises';
import * as path from 'path';
import { capitalize, prettier } from './formatting';
import { toPascalCase, toKebabCase } from './convert-string-cases';

interface IOption {
  useLibraryNamePath: boolean;
  importServices: boolean;
}

export async function createModule(
  libraryPath: string,
  libraryName: string,
  options: IOption = {
    useLibraryNamePath: false,
    importServices: false,
  },
) {
  const modulePath = path.join(
    libraryPath,
    options.useLibraryNamePath ? toKebabCase(libraryName) : 'src',
  );
  await fs.mkdir(modulePath, { recursive: true });

  const moduleImports = `
import { AdminModule } from '@hedhog/admin';
import { PaginationModule } from '@hedhog/pagination';
import { PrismaModule } from '@hedhog/prisma';
import { forwardRef, Module } from '@nestjs/common';`;

  const serviceName = `${toPascalCase(libraryName)}Service`;
  const controllerName = `${toPascalCase(libraryName)}Controller`;

  const additionalImports = options.importServices
    ? `
import { ${serviceName} } from './${toKebabCase(libraryName)}.service';
import { ${controllerName} } from './${toKebabCase(libraryName)}.controller';`
    : '';

  const moduleContent = `
${moduleImports}${additionalImports}
@Module({
  imports: [
    forwardRef(() => AdminModule),
    forwardRef(() => PrismaModule),
    forwardRef(() => PaginationModule),
  ],
  controllers: ${options.importServices ? `[${controllerName}]` : '[]'},
  providers: ${options.importServices ? `[${serviceName}]` : '[]'},
  exports: ${options.importServices ? `[${serviceName}]` : '[]'},
})
export class ${toPascalCase(libraryName)}Module {}
  `.trim();

  const moduleFilePath = path.join(
    modulePath,
    `${toKebabCase(libraryName)}.module.ts`,
  );
  await fs.writeFile(moduleFilePath, moduleContent);
  await prettier(moduleFilePath);
}
