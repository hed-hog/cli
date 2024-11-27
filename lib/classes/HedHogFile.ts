import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { Table } from '../types/table';

export type HedhogFileType = {
  tables?: Record<string, any>;
  screens?: Record<string, any>;
  data?: Record<string, any>;
};

export class HedhogFile {
  private _path: string = '';
  private _content: HedhogFileType = {};

  async load(path: string) {
    this._path = path;
    await this.init();
    return this;
  }

  private async init() {
    if (existsSync(this._path)) {
      this._content = parse(await readFile(this._path, 'utf-8'));
    }
  }

  get tables() {
    return this._content.tables;
  }

  get tableNames(): string[] {
    return Object.keys(this._content.tables || {});
  }

  getTables(): Table[] {
    return this.tableNames.map((tableName) => ({
      name: tableName,
      columns: this._content.tables?.[tableName]?.columns,
      ifNotExists: this._content.tables?.[tableName].ifNotExists,
    })) as Table[];
  }

  hasLocale(tableName: string) {
    const key = `${tableName}_locale`;
    return this._content.tables ? key in this._content.tables : false;
  }

  get screensWithRelations() {
    if (!this._content.screens) {
      throw new Error('No screens found in the hedhog file');
    }

    const screens = this._content.screens || {};
    return Object.keys(screens)
      .filter((screen) => screens[screen].relations)
      .map((screen) => ({
        name: screen,
        relations: Object.keys(screens[screen].relations),
      }));
  }
}
