import * as fs from 'fs/promises';
import * as path from 'path';
import { capitalize } from './formatting';

export async function createModule(libraryPath: string, libraryName: string) {
  const modulePath = path.join(libraryPath, 'src');
  await fs.mkdir(modulePath, { recursive: true });

  const moduleContent = `
import { AuthModule } from '@hedhog/auth';
import { PaginationModule } from '@hedhog/pagination';
import { PrismaModule } from '@hedhog/prisma';
import { forwardRef, Module } from '@nestjs/common';
import { ${capitalize(libraryName)}Service } from './${libraryName}.service';
import { ${capitalize(libraryName)}Controller } from './${libraryName}.controller';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => PrismaModule),
    forwardRef(() => PaginationModule),
  ],
  controllers: [${capitalize(libraryName)}Controller],
  providers: [${capitalize(libraryName)}Service],
  exports: [${capitalize(libraryName)}Service],
})
export class ${capitalize(libraryName)}Module {}
  `.trim();

  await fs.writeFile(
    path.join(modulePath, `${libraryName}.module.ts`),
    moduleContent,
  );
}
