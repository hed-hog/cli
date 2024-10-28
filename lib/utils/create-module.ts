import * as fs from 'fs/promises';
import * as path from 'path';
import { capitalize, prettier } from './formatting';

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
    options.useLibraryNamePath ? libraryName : 'src',
  );
  await fs.mkdir(modulePath, { recursive: true });

  const moduleImports = `
import { AdminModule } from '@hedhog/admin';
import { PaginationModule } from '@hedhog/pagination';
import { PrismaModule } from '@hedhog/prisma';
import { forwardRef, Module } from '@nestjs/common';`;

  const serviceName = `${capitalize(libraryName)}Service`;
  const controllerName = `${capitalize(libraryName)}Controller`;

  const additionalImports = options.importServices
    ? `
import { ${serviceName} } from './${libraryName}.service';
import { ${controllerName} } from './${libraryName}.controller';`
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
export class ${capitalize(libraryName ?? libraryName)}Module {}
  `.trim();

  const moduleFilePath = path.join(
    modulePath,
    `${libraryName ? libraryName : libraryName}.module.ts`,
  );
  await fs.writeFile(moduleFilePath, moduleContent);
  await prettier(moduleFilePath);
}
