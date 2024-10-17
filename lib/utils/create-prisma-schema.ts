import { join } from 'path';
import { mkdirRecursive } from './checkVersion';
import { writeFile } from 'fs/promises';

export async function createPrismaSchema(
  path: string,
  type: 'postgres' | 'mysql',
) {
  await mkdirRecursive(path);

  const prismaSchemaContent = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${type === 'mysql' ? 'mysql' : 'postgresql'}"
  url      = env("DATABASE_URL")
}`;

  await writeFile(join(path, 'schema.prisma'), prismaSchemaContent, 'utf-8');
}
