import * as fs from 'fs/promises';
import * as path from 'path';
import { prettier } from './formatting';

export async function createDTOs(libraryPath: string, fields: string) {
  const dtoPath = path.join(libraryPath, 'src', 'dto');
  await fs.mkdir(dtoPath, { recursive: true });

  await createDeleteDTO(dtoPath);
  await createCreateDTO(dtoPath, fields);
  await createUpdateDTO(dtoPath, fields);
}

async function createDeleteDTO(dtoPath: string) {
  const deleteDTOContent = `
import { ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class DeleteDTO {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  ids: number[];
}
    `.trim();

  const deleteDtoFilePath = path.join(dtoPath, 'delete.dto.ts');
  await fs.writeFile(deleteDtoFilePath, deleteDTOContent);
  await prettier(deleteDtoFilePath);
}

function parseFields(fields: string): any[] {
  return fields.split(',').map((field) => {
    const [name, type, length] = field.split(':');
    return { name, type, length };
  });
}

function getPrimitiveType(type: string): string {
  switch (type) {
    case 'varchar':
      return 'string';
    case 'int':
      return 'number';
    case 'date':
      return 'Date';
    case 'boolean':
      return 'boolean';
    case 'decimal':
      return 'number';
    case 'text':
      return 'string';
    case 'json':
      return 'any';
    default:
      return 'string';
  }
}

function getValidator(field: any, isOptional = false): string {
  const { name, type, length } = field;
  const validations: string[] = [];

  switch (type) {
    case 'varchar':
      validations.push(`@IsString()`);
      if (length) validations.push(`@Length(0, ${length})`);
      break;
    case 'int':
      validations.push(`@IsInt()`);
      break;
    case 'decimal':
      validations.push(`@IsDecimal()`);
      break;
    case 'date':
      validations.push(`@IsDate()`);
      break;
    case 'boolean':
      validations.push(`@IsBoolean()`);
      break;
    case 'fk':
      validations.push(`@IsInt()`);
      break;
    default:
      validations.push(`@IsString()`);
  }

  if (isOptional) {
    validations.push('@IsOptional()');
  }

  return `${validations.join('\n  ')}\n  ${name}${isOptional && !field.name.includes('?') ? '?' : ''}: ${type === 'fk' ? 'number' : getPrimitiveType(type)};`;
}

async function createCreateDTO(dtoPath: string, fields: string) {
  const parsedFields = parseFields(fields);
  const dtoFields = parsedFields
    .map((field) => getValidator(field))
    .join('\n\n  ');

  const createDTOContent = `
import { IsString, IsInt, IsOptional, Length, IsDate, IsDecimal, IsBoolean } from 'class-validator';

export class CreateDTO {
  ${dtoFields}
}
    `.trim();

  const createDtoFilePath = path.join(dtoPath, 'create.dto.ts');
  await fs.writeFile(createDtoFilePath, createDTOContent);
  await prettier(createDtoFilePath);
}

async function createUpdateDTO(dtoPath: string, fields: string) {
  const parsedFields = parseFields(fields);
  const dtoFields = parsedFields
    .map((field) => getValidator(field, true))
    .join('\n\n  ');

  const updateDTOContent = `
import { IsString, IsInt, IsOptional, Length, IsDate, IsDecimal, IsBoolean } from 'class-validator';

export class UpdateDTO {
  ${dtoFields}
}
    `.trim();

  const updateDtoFilePath = path.join(dtoPath, 'update.dto.ts');
  await fs.writeFile(updateDtoFilePath, updateDTOContent);
  await prettier(updateDtoFilePath);
}
