import * as fs from 'fs/promises';
import * as path from 'path';
import { capitalize, prettier } from './formatting';

export async function createModule(libraryPath: string, libraryName: string) {
  const modulePath = path.join(libraryPath, 'src');
  await fs.mkdir(modulePath, { recursive: true });

  const moduleContent = `
import { AdminModule } from '@hedhog/admin';
import { PaginationModule } from '@hedhog/pagination';
import { PrismaModule } from '@hedhog/prisma';
import { forwardRef, Module } from '@nestjs/common';
import { ${capitalize(libraryName)}Service } from './${libraryName}.service';
import { ${capitalize(libraryName)}Controller } from './${libraryName}.controller';

@Module({
  imports: [
    forwardRef(() => AdminModule),
    forwardRef(() => PrismaModule),
    forwardRef(() => PaginationModule),
  ],
  controllers: [${capitalize(libraryName)}Controller],
  providers: [${capitalize(libraryName)}Service],
  exports: [${capitalize(libraryName)}Service],
})
export class ${capitalize(libraryName)}Module {}
  `.trim();

  const moduleFilePath = path.join(modulePath, `${libraryName}.module.ts`);
  await fs.writeFile(moduleFilePath, moduleContent);
  await prettier(moduleFilePath);
}
