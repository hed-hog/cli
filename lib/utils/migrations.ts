import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path = require('path');
import { Runner, RunnerFactory } from '../runners';
import { prettier } from './formatting';

export async function createMigrationDirectory(
  libraryPath: string,
  tableName: string,
  fieldsInput: string,
) {
  const migrationPath = path.join(libraryPath, 'src', 'migrations');

  if (!existsSync(migrationPath)) {
    await mkdir(migrationPath, { recursive: true });
  }

  const fields = parseFields(fieldsInput);

  const migrationContent = `
import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';
import { idColumn, timestampColumn } from '@hedhog/utils';

export class Migration implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: '${tableName}',
        columns: [
            idColumn(),
            ${fields.map((field, index) => generateColumnDefinition(field, index))},
            timestampColumn(),
            timestampColumn('updated_at'),
        ],
      })
    );

    ${generateForeignKeys(tableName, fields)}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('${tableName}');
  }
}
    `.trim();

  const migrationFilePath = path.join(migrationPath, 'index.ts');

  await writeFile(migrationFilePath, migrationContent);
  await prettier(migrationFilePath);
}

function generateColumnDefinition(field: any, index: number) {
  let columnParts: string[] = [
    `name: '${field.name}'`,
    `type: '${field.type === 'fk' ? 'int' : field.type}'`,
  ];

  if (field.type === 'fk') {
    columnParts.push('unsigned: true');
  }

  if (field.length) {
    columnParts.push(`length: '${field.length}'`);
  }

  columnParts.push(`isNullable: ${field.isNullable ? 'true' : 'false'}`);

  let column = `{
    ${columnParts.join(',\n    ')}
  }`;

  return column;
}

export function parseFields(fieldsInput: string) {
  return fieldsInput.split(',').map((field) => {
    const [name, type, lengthOrRef, foreignTable, foreignColumn] =
      field.split(':');
    const isOptional = name.endsWith('?');
    const fieldName = name.replace('?', '');

    return {
      name: fieldName,
      type: type || 'varchar',
      length:
        lengthOrRef && !isNaN(Number(lengthOrRef)) ? lengthOrRef : undefined,
      isNullable: isOptional,
      isForeignKey: type === 'fk',
      foreignTable: foreignTable || null,
      foreignColumn: foreignColumn || null,
    };
  });
}

function generateForeignKeys(tableName: string, fields: any[]) {
  const foreignKeys = fields
    .filter((field) => field.isForeignKey)
    .map(
      (field) => `
    await queryRunner.createForeignKey(
      '${tableName}',
      new TableForeignKey({
        columnNames: ['${field.name}'],
        referencedTableName: '${field.foreignTable}',
        referencedColumnNames: ['${field.foreignColumn}'],
        onDelete: 'CASCADE',
      }),
    );`,
    )
    .join('\n');

  return foreignKeys;
}
