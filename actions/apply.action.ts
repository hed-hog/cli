import chalk = require('chalk');
import { AbstractAction } from '.';
import { Input } from '../commands';
import path = require('path');
import { createService } from '../lib/utils/create-service';
import { createController } from '../lib/utils/create-controller';
import * as yaml from 'yaml';
import { readFileSync } from 'fs';
import { createModule } from '../lib/utils/create-module';
import { createDTOs } from '../lib/utils/create-dto';
import { writeFile } from 'fs/promises';
import { capitalize } from '../lib/utils/formatting';

interface Column {
  name: string;
  type: string;
  length?: number;
  isPrimary: boolean;
  references?: {
    table: string;
    column: string;
    onDelete: string;
  };
}

interface Table {
  name: string;
  columns: Column[];
  ifNotExists: boolean;
}

export class ApplyAction extends AbstractAction {
  public async handle(inputs: Input[]) {
    const libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    if (!libraryName.length) {
      console.error(chalk.red('You must tell a name for the module.'));
      process.exit(1);
    }

    if (/\s/.test(libraryName)) {
      console.error(
        chalk.red('Error: The library name should not contain spaces.'),
      );
      process.exit(1);
    }

    const hedhogFilePath = path.join(process.cwd(), 'hedhog.yaml');
    const libraryPath = path.join(process.cwd(), 'src');
    const tables = this.parseYamlFile(hedhogFilePath);

    for (const table of tables) {
      const fields = table.columns
        .map((column) => {
          const lengthPart = column.length ? `:${column.length}` : '';
          return `${column.name}:${column.type}${lengthPart}`;
        })
        .join(',');

      await createDTOs(path.join(libraryPath, table.name), fields);
      await createService(libraryPath, table.name, table.columns);
      await createModule(libraryPath, table.name, {
        useLibraryNamePath: true,
        importServices: true,
      });
      await createController(libraryPath, table.name);
      await this.updateParentModule(
        path.join(libraryPath, `${libraryName}.module.ts`),
        table.name,
      );
    }
  }

  private parseYamlFile(filePath: string) {
    const fileContents = readFileSync(filePath, 'utf8');
    const data = yaml.parse(fileContents);

    const tables: Table[] = Object.keys(data.tables).map((tableName) => ({
      name: tableName,
      columns: data.tables[tableName].columns,
      ifNotExists: data.tables[tableName].ifNotExists,
    }));

    return tables;
  }

  private async updateParentModule(modulePath: string, newModuleName: string) {
    if (!modulePath) {
      console.error(chalk.red(`Parent module file not found.`));
      return;
    }

    newModuleName = capitalize(newModuleName);

    try {
      let moduleContent = await readFileSync(modulePath, 'utf8');

      const importStatement = `import { ${newModuleName}Module } from './${newModuleName}/${newModuleName}.module';`;
      if (!moduleContent.includes(importStatement)) {
        moduleContent = `${importStatement}\n\n${moduleContent}`;
      }

      const moduleImportRegex = /imports:\s*\[(.*?)\]/s;
      moduleContent = moduleContent.replace(moduleImportRegex, (match) => {
        return match.replace(']', `,\n    ${newModuleName}Module]`);
      });

      await writeFile(modulePath, moduleContent);
    } catch (error) {
      console.error(
        chalk.red(`Error updating parent module: ${error.message}`),
      );
    }
  }
}
