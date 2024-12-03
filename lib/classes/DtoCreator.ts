import * as fs from 'fs/promises';
import * as path from 'path';
import { formatTypeScriptCode } from '../utils/format-typescript-code';
import { render } from 'ejs';
import { capitalize } from '../utils/convert-string-cases';
import { Table } from '../../lib/types/table';
import { Column } from '../types/column';

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
    const dtoPath = path.join(this.libraryPath, 'dto');
    await fs.mkdir(dtoPath, { recursive: true });

    await this.createCreateDTO(dtoPath);
    await this.createUpdateDTO(dtoPath);
  }

  private getPrimitiveType(type: string): string {
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

  private async writeFormattedFile(filePath: string, content: string) {
    const formattedContent = await formatTypeScriptCode(content, {
      parser: 'typescript',
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    });
    await fs.writeFile(filePath, formattedContent);
  }

  private async loadTemplate(templateName: string): Promise<string> {
    const templatePath = path.join(
      __dirname,
      '..',
      '..',
      'templates',
      'dto',
      templateName,
    );
    return fs.readFile(templatePath, 'utf-8');
  }

  private hasOptional(column: Column) {
    return column.isNullable === true || column.default !== undefined;
  }

  private async createCreateDTO(dtoPath: string) {
    let importsSet = new Set<string>();
    const dtoFields = [];
    let hasOptional = false;

    for (const f of this.fields) {
      const importTemplateContent =
        await this.loadTemplate('import.dto.ts.ejs');
      const type = this.getPrimitiveType(f.type);
      const renderedImport = render(importTemplateContent, {
        type: capitalize(type),
      });
      importsSet.add(renderedImport);

      const fieldTemplateContent = await this.loadTemplate(
        `${type}.dto.ts.ejs`,
      );
      let renderedField = render(fieldTemplateContent, {
        fieldName: f.name,
        optionalSignal: this.hasOptional(f) ? '?' : '',
        isOptional: this.hasOptional(f),
      });

      if (this.hasOptional(f)) {
        hasOptional = true;
      }

      dtoFields.push(renderedField);
    }

    const imports = Array.from(importsSet);

    if (hasOptional) {
      imports.push("import { IsOptional } from 'class-validator';");
    }

    const createTemplateContent = await this.loadTemplate('create.dto.ts.ejs');
    const createDTOContent = render(createTemplateContent, {
      fields: dtoFields.join('\n\n'),
      imports: imports.join('\n'),
      hasLocale: this.hasLocale,
    });

    const createDtoFilePath = path.join(dtoPath, 'create.dto.ts');
    await this.writeFormattedFile(createDtoFilePath, createDTOContent);
  }

  private async createUpdateDTO(dtoPath: string) {
    const updateTemplateContent = await this.loadTemplate('update.dto.ts.ejs');
    const updateDtoFilePath = path.join(dtoPath, 'update.dto.ts');
    await this.writeFormattedFile(updateDtoFilePath, updateTemplateContent);
  }
}
