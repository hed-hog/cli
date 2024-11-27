import * as fs from 'fs/promises';
import * as path from 'path';
import { formatTypeScriptCode } from './format-typescript-code';
import { render } from 'ejs';
import { capitalize } from './convert-string-cases';

export async function createDTOs(
  libraryPath: string,
  fields: string,
  hasLocale: boolean,
) {
  const dtoPath = path.join(libraryPath, 'dto');
  await fs.mkdir(dtoPath, { recursive: true });

  await createCreateDTO(dtoPath, fields, hasLocale);
  await createUpdateDTO(dtoPath);
}

function parseFields(fields: string): any[] {
  return fields.split(',').map((field) => {
    const [name, type, length, isNullable] = field.split(':');
    return { name, type, length, isNullable };
  });
}

function getPrimitiveType(type: string): string {
  switch (type) {
    case 'varchar':
    case 'date':
    case 'text':
      return 'string';
    case 'int':
    case 'decimal':
    case 'fk':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

async function createCreateDTO(
  dtoPath: string,
  fields: string,
  hasLocale: boolean,
) {
  const parsedFields = parseFields(fields);
  const imports = [];
  for (const f of parsedFields) {
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'dto', `import.dto.ts.ejs`);
    const templateContent = await fs.readFile(templatePath, 'utf-8'); 
    const type = getPrimitiveType(f.type);
    const rendered = render(templateContent, {
      type: capitalize(type),
    });
    imports.push(rendered); 
  }
  
  // Handle dtoFields
  const dtoFields = [];
  for (const f of parsedFields) {
    const type = getPrimitiveType(f.type);
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'dto', `${type}.dto.ts.ejs`);
    const templateContent = await fs.readFile(templatePath, 'utf-8'); 
    const rendered = render(templateContent, {
      fieldName: f.name,
    });
    dtoFields.push(rendered);
  }
  
  console.log({ imports, dtoFields });
  const createDTOContent = render(path.join(__dirname,
    '..',
    '..',
    'templates', 'dto', 'create.dto.ts.ejs'), {
      fields: dtoFields,
      imports,
      hasLocale
    })

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
  const updateDtoFilePath = path.join(dtoPath, 'update.dto.ts');
  const updateDTOContent = render(path.join(__dirname,
    '..',
    '..',
    'templates', 'dto', 'update.dto.ts.ejs'))

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
