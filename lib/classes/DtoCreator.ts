import { render } from 'ejs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Column } from '../types/column';
import { capitalize } from '../utils/convert-string-cases';
import { formatTypeScriptCode } from '../utils/format-typescript-code';

export class DTOCreator {
  private libraryPath: string;
  private fields: Column[];
  private hasLocale: boolean;

  constructor(libraryPath: string, fields: Column[], hasLocale: boolean) {
    this.libraryPath = libraryPath;
    this.fields = fields;
    this.hasLocale = hasLocale;
  }

  async createDTOs() {
    const dtoPath = join(this.libraryPath, 'dto');
    await mkdir(dtoPath, { recursive: true });

    await this.createDTO('create', dtoPath);
    await this.createDTO('update', dtoPath);
  }

  private getPrimitiveType(type: string): string {
    const typeMapping: Record<string, string> = {
      varchar: 'string',
      date: 'string',
      text: 'string',
      int: 'number',
      decimal: 'number',
      fk: 'number',
      boolean: 'boolean',
    };
    return typeMapping[type] || 'string';
  }

  private async writeFormattedFile(filePath: string, content: string) {
    const formattedContent = await formatTypeScriptCode(content, {
      parser: 'typescript',
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    });
    await writeFile(filePath, formattedContent);
  }

  private async loadTemplate(templateName: string): Promise<string> {
    const templatePath = join(
      __dirname,
      '..',
      '..',
      'templates',
      'dto',
      templateName,
    );
    return readFile(templatePath, 'utf-8');
  }

  private hasOptional(column: Column): boolean {
    return column.isNullable || column.default !== undefined;
  }

  private async createDTO(type: 'create' | 'update', dtoPath: string) {
    const importsSet = new Set<string>();
    const dtoFields: string[] = [];
    const dtoImports = new Set<string>();
    let hasOptional = false;

    if (type === 'create') {
      // Process fields for "create" DTO
      for (const field of this.fields) {
        const primitiveType = this.getPrimitiveType(field.type);
        dtoImports.add(primitiveType);

        const renderedField = await this.renderField(field, primitiveType);
        if (this.hasOptional(field)) {
          hasOptional = true;
        }
        dtoFields.push(renderedField);
      }

      await this.addImports(dtoImports, importsSet, hasOptional);

      const dtoContent = await this.renderDTO({
        fields: dtoFields,
        imports: Array.from(importsSet),
        hasLocale: this.hasLocale,
        templateName: `${type}.dto.ts.ejs`,
      });

      const filePath = join(dtoPath, `${type}.dto.ts`);
      await this.writeFormattedFile(filePath, dtoContent);
    } else if (type === 'update') {
      // Render template for "update" DTO
      const updateTemplateContent =
        await this.loadTemplate('update.dto.ts.ejs');
      const filePath = join(dtoPath, 'update.dto.ts');
      await this.writeFormattedFile(filePath, updateTemplateContent);
    }
  }

  private async renderField(field: Column, type: string): Promise<string> {
    const templateContent = await this.loadTemplate(`${type}.dto.ts.ejs`);
    return render(templateContent, {
      fieldName: field.name,
      optionalSignal: this.hasOptional(field) ? '?' : '',
      isOptional: this.hasOptional(field),
    });
  }

  private async addImports(
    dtoImports: Set<string>,
    importsSet: Set<string>,
    hasOptional: boolean,
  ) {
    const importTemplateContent = await this.loadTemplate('import.dto.ts.ejs');
    const types = Array.from(dtoImports).map((type) => `Is${capitalize(type)}`);
    if (hasOptional) {
      types.push('IsOptional');
    }

    const renderedImport = render(importTemplateContent, {
      types: types.join(','),
    });

    importsSet.add(renderedImport);
  }

  private async renderDTO(params: {
    fields: string[];
    imports: string[];
    hasLocale: boolean;
    templateName: string;
  }): Promise<string> {
    const { fields, imports, hasLocale, templateName } = params;
    const templateContent = await this.loadTemplate(templateName);
    return render(templateContent, {
      fields: fields.join('\n\n'),
      imports: imports.join('\n'),
      hasLocale,
    });
  }
}
