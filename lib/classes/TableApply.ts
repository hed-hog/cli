import { Table } from '../types/table';
import { HedhogFile } from './HedHogFile';

export class TableApply {
  private _hedhogFile: HedhogFile = new HedhogFile();
  private _hasRelations = false;
  private _hasLocale = false;
  private _baseName = '';
  private _tableNameRelation = '';
  private _pkName = '';
  private _fkName = '';

  constructor(private _table: Table) {
    this.initBaseName();
    this.initHasLocale();
  }

  get baseName() {
    if (!this._baseName) {
      this.initBaseName();
    }
    return this._baseName;
  }

  get hasRelations() {
    return this._hasRelations;
  }

  get hasLocale() {
    if (!this._hasLocale) {
      this.initHasLocale();
    }
    return this._hasLocale;
  }

  get tableNameRelation() {
    if (!this._tableNameRelation) {
      this.findTableWithRelation();
    }
    return this._tableNameRelation;
  }

  get pkName() {
    if (!this._pkName) {
      this._pkName =
        this.getColumns().find((column) => column.type === 'pk')?.name || '';
    }
    return this._pkName;
  }

  get fkName() {
    if (!this._fkName) {
      if (!this._tableNameRelation) {
        this.findTableWithRelation();
      }
      this._fkName =
        this.getColumns().find(
          (t) => t.references?.table === this.tableNameRelation,
        )?.name ?? '';
    }
    return this._fkName;
  }

  get hedhogFile() {
    return this._hedhogFile;
  }

  initHasLocale() {
    this._hasLocale = this._hedhogFile.hasLocale(this._table.name);
  }

  initBaseName() {
    this._baseName = this._table.name.replace(/_locales$/, '');
  }

  setHedhogFile(hedhogFile: any) {
    this._hedhogFile = hedhogFile;
  }

  findTableWithRelation() {
    const relations = this._hedhogFile
      .screensWithRelations()
      .filter((item) => item.relations.includes(this._table.name))
      .map((item) => item.name);

    return (this._tableNameRelation = relations.length ? relations[0] : '');
  }

  getColumns() {
    return this._table.columns.map((column) => {
      if (!column.name) {
        switch (column.type) {
          case 'pk':
            column.name = 'id';
            break;
          case 'order':
          case 'slug':
          case 'created_at':
          case 'updated_at':
            column.name = column.type;
        }
      }
      return column;
    });
  }
}
