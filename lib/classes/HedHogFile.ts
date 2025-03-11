import { writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import { stringify } from 'yaml';
import { Menu } from '../types/menu';
import { Table } from '../types/table';
import { loadHedhogFile } from '../utils/load-hedhog-file';

export interface Route {
  url: string;
  method: string;
  relations?: any;
}

interface ReactRoute {
  path: string;
  component?: string;
  lazy?: {
    component: string;
  };
  children?: ReactRoute[];
}

interface HedhogData {
  route?: Route[];
  menu?: Menu[];
  screen?: Screen[];
}

export type HedhogFileType = {
  tables?: Record<string, any>;
  screens?: Record<string, any>;
  data?: HedhogData;
  routes?: ReactRoute[];
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
      this._content = await loadHedhogFile(this._path);
    }
  }

  get tables() {
    return this._content.tables ?? {};
  }

  set tables(tables: Record<string, any>) {
    this._content.tables = tables;
  }

  get data() {
    return this._content.data ?? {};
  }

  set data(data: Record<string, any>) {
    this._content.data = data;
  }

  get screens() {
    return this._content.screens ?? {};
  }

  set screens(screens: Record<string, any>) {
    this._content.screens = screens;
  }

  get routes() {
    return this._content.routes ?? [];
  }

  set routes(routes: ReactRoute[]) {
    this._content.routes = routes;
  }

  get tableNames(): string[] {
    return Object.keys(this._content.tables || {});
  }

  async save() {
    const newYamlContent = stringify(this._content);
    return writeFile(this._path, newYamlContent, 'utf8');
  }

  getTables(): Table[] {
    return this.tableNames.map((tableName) => ({
      name: tableName,
      columns: this._content.tables?.[tableName]?.columns.map(
        this.applyColumnDefaults,
      ),
      ifNotExists: this._content.tables?.[tableName].ifNotExists,
    })) as Table[];
  }

  applyColumnDefaults(column: any) {
    return {
      name:
        column.type === 'pk'
          ? 'id'
          : column.type === 'slug'
            ? 'slug'
            : column.type === 'created_at'
              ? 'created_at'
              : column.type === 'updated_at'
                ? 'updated_at'
                : column.type === 'deleted_at'
                  ? 'deleted_at'
                  : column.type === 'order'
                    ? 'order'
                    : undefined,
      ...column,
      isPrimary: column.isPrimary || column.type === 'pk',
      isNullable: column.isNullable || false,
    };
  }

  getTable(tableName: string): Table {
    return {
      name: tableName,
      columns: this._content.tables?.[tableName]?.columns.map(
        this.applyColumnDefaults,
      ),
      ifNotExists: this._content.tables?.[tableName].ifNotExists,
    };
  }

  hasLocale(tableName: string) {
    const key = `${tableName}_locale`;
    return this._content.tables ? key in this._content.tables : false;
  }

  get screensWithRelations() {
    if (!this._content.screens) {
      return [];
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
