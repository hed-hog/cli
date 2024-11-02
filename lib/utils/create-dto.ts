import * as fs from 'fs/promises';
import * as path from 'path';
import { formatTypeScriptCode } from './format-typescript-code';

export async function createDTOs(
  libraryPath: string,
  fields: string,
  hasLocale: boolean,
) {
  const dtoPath = path.join(libraryPath, 'dto');
  await fs.mkdir(dtoPath, { recursive: true });

  await createDeleteDTO(dtoPath);
  await createCreateDTO(dtoPath, fields, hasLocale);
  await createUpdateDTO(dtoPath);
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
  await fs.writeFile(
    deleteDtoFilePath,
    await formatTypeScriptCode(deleteDTOContent, {
      parser: 'typescript',
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    }),
  );
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

function getValidator(
  field: any,
  isOptional = false,
  decoratorsUsed: Set<string>,
): string {
  const { name, type, length } = field;
  const validations: string[] = [];

  switch (type) {
    case 'varchar':
      decoratorsUsed.add('IsString');
      validations.push(`@IsString()`);
      if (length) {
        decoratorsUsed.add('Length');
        validations.push(`@Length(0, ${length})`);
      }
      break;
    case 'int':
      decoratorsUsed.add('IsInt');
      validations.push(`@IsInt()`);
      break;
    case 'decimal':
      decoratorsUsed.add('IsDecimal');
      validations.push(`@IsDecimal()`);
      break;
    case 'date':
      decoratorsUsed.add('IsDate');
      validations.push(`@IsDate()`);
      break;
    case 'boolean':
      decoratorsUsed.add('IsBoolean');
      validations.push(`@IsBoolean()`);
      break;
    case 'fk':
      decoratorsUsed.add('IsInt');
      validations.push(`@IsInt()`);
      break;
    default:
      decoratorsUsed.add('IsString');
      validations.push(`@IsString()`);
  }

  if (isOptional) {
    decoratorsUsed.add('IsOptional');
    validations.push('@IsOptional()');
  }

  return `${validations.join('\n  ')}\n  ${name}${isOptional && !field.name.includes('?') ? '?' : ''}: ${type === 'fk' ? 'number' : getPrimitiveType(type)};`;
}

async function createCreateDTO(
  dtoPath: string,
  fields: string,
  hasLocale: boolean,
) {
  const parsedFields = parseFields(fields);
  const decoratorsUsed = new Set<string>();
  const dtoFields = parsedFields
    .map((field) => getValidator(field, false, decoratorsUsed))
    .join('\n\n  ');

  const imports = `import { ${Array.from(decoratorsUsed).join(', ')} } from 'class-validator';${hasLocale ? "import { WithLocaleDTO } from '@hedhog/admin';" : ''}`;

  const createDTOContent = `
${imports}

export class CreateDTO ${hasLocale ? 'extends WithLocaleDTO' : ''} {
  ${dtoFields}
}
  `.trim();

  const createDtoFilePath = path.join(dtoPath, 'create.dto.ts');
  await fs.writeFile(
    createDtoFilePath,
    await formatTypeScriptCode(createDTOContent, {
      parser: 'typescript',
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    }),
  );
}

async function createUpdateDTO(dtoPath: string) {
  const updateDTOContent = `
    import { PartialType } from '@nestjs/mapped-types';
    import { CreateDTO } from './create.dto';
    
    export class UpdateDTO extends PartialType(CreateDTO) {}`.trim();

  const updateDtoFilePath = path.join(dtoPath, 'update.dto.ts');
  await fs.writeFile(
    updateDtoFilePath,
    await formatTypeScriptCode(updateDTOContent, {
      parser: 'typescript',
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    }),
  );
}
