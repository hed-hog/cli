import { AbstractDatabase } from '../databases';
import { DataType } from '../types/data-type';
import { Locale } from '../types/locale';
import { pluralToSingular } from '../utils/plural-to-singular';
import { Entity } from './entity';

type DataInsertRelation = {
  tablaName: string;
  fields: string[];
  values: any[];
};

type DataInsert = {
  query: string;
  values: any[];
  relations?: DataInsertRelation[];
};

export class AbstractEntity {
  private locales: { [key: string]: number } = {};

  constructor(
    protected db: AbstractDatabase,
    protected name: Entity,
    protected data: DataType[],
  ) {}

  static isRelation(key: string) {
    return key === 'relations';
  }

  static isWhere(item: DataType, key: string) {
    return typeof item[key] === 'object' && item[key].where;
  }

  static isLocale(item: DataType, key: string) {
    return (
      typeof item[key] === 'object' &&
      this.countKeyLength(item[key] as Locale).length === 1 &&
      this.countKeyLength(item[key] as Locale)[0] === 2
    );
  }

  static countKeyLength(item: Locale) {
    return [...new Set(Object.keys(item).map((key) => key.length))];
  }

  private getLocaleTableName(mainTableName: string) {
    const mainTableNameSplitted = mainTableName.split('_');
    const lastName = pluralToSingular(mainTableNameSplitted.pop() as string);
    const firstName = mainTableNameSplitted.join('_');
    const translations_suffix = 'translations';

    return !firstName
      ? `${lastName}_${translations_suffix}`
      : `${firstName}_${lastName}_${translations_suffix}`;
  }

  private async getLocaleId(code: string) {
    console.log('getLocaleId', { code });

    if (this.locales[code]) {
      console.log('locale_id:', this.locales[code]);
      return this.locales[code];
    }

    const locales = await this.db.query(
      'SELECT id FROM locales WHERE code = ?',
      [code],
    );

    if (!locales.length) {
      throw new Error(`Locale with code "${code}" not found.`);
    }

    console.log('locale_id:', locales[0].id);

    return (this.locales[code] = locales[0].id);
  }

  private async insert(items: DataType[]) {
    const mainInserts: DataInsert[] = [];
    const localeInserts: DataInsert[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mainTableName = this.name;
      const mainFields: string[] = [];
      const mainValues: any[] = [];

      for (const key of Object.keys(item)) {
        if (
          !AbstractEntity.isRelation(key) &&
          !AbstractEntity.isWhere(item, key) &&
          !AbstractEntity.isLocale(item, key)
        ) {
          mainFields.push(key);
          mainValues.push(item[key]);
        }
      }

      const primaryKeys = await this.db.getPrimaryKeys(mainTableName);

      const id = (
        await this.db.query(
          `INSERT INTO ${mainTableName} (${mainFields.join(', ')}) VALUES (${mainValues.map((_) => '?').join(', ')})`,
          mainValues,
          {
            returning: primaryKeys,
            primaryKeys,
          },
        )
      )[0][primaryKeys[0]];

      console.log({
        item,
        id,
      });

      const localeColumns: string[] = [];

      for (const key of Object.keys(item)) {
        if (AbstractEntity.isLocale(item, key)) {
          localeColumns.push(key);
        }
      }

      console.log({ localeColumns });

      //TO DO insert to _translations table
    }
  }

  async apply() {
    await this.insert(this.data);
  }
}
