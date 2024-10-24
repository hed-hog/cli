import chalk = require('chalk');
import { AbstractDatabase } from '../databases';
import { DataType } from '../types/data-type';
import { Locale } from '../types/locale';
import { pluralToSingular } from '../utils/plural-to-singular';
import { Entity } from './entity';
import EventEmitter = require('events');

export class AbstractEntity {
  private locales: { [key: string]: number } = {};
  private eventEmitter = new EventEmitter();

  constructor(
    protected db: AbstractDatabase,
    protected name: Entity,
    protected data: DataType[],
  ) {}

  on(event: string, listener: (...args: any[]) => void) {
    return this.eventEmitter.on(event, listener);
  }

  static isRelation(item: DataType, key: string) {
    return key === 'relations' && typeof item[key] === 'object';
  }

  static isWhere(item: DataType, key: string) {
    return typeof item[key] === 'object' && typeof item[key].where === 'object';
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
    if (this.locales[code]) {
      return this.locales[code];
    }

    const locales = await this.db.query(
      'SELECT id FROM locales WHERE code = ?',
      [code],
    );

    if (!locales.length) {
      throw new Error(`Locale with code "${code}" not found.`);
    }

    return (this.locales[code] = locales[0].id);
  }

  private parseOperator(operator: string) {
    switch (operator) {
      case 'eq':
        return '=';
      case 'ne':
        return '<>';
      case 'gt':
        return '>';
      case 'lt':
        return '<';
      case 'gte':
        return '>=';
      case 'lte':
        return '<=';
      case 'like':
        return 'LIKE';
      case 'nlike':
        return 'NOT LIKE';
      case 'in':
        return 'IN';
      case 'nin':
        return 'NOT IN';
      default:
        throw new Error(`Operator "${operator}" not found.`);
    }
  }

  private async whereResolve(tableName: string, where: Record<string, any>) {
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);
    const whereQuery = [] as string[];
    const whereFinal = [] as any[];

    for (let i = 0; i < whereKeys.length; i++) {
      const whereValue = whereValues[i];

      if (typeof whereValue === 'object') {
        const operator = Object.keys(whereValue)[0];

        let value: string = whereValue[operator] as string;

        if (['in', 'nin'].includes(operator) && Array.isArray(value)) {
          whereQuery.push(
            this.db.getWhereWithIn(
              whereKeys[i],
              operator as 'in' | 'nin',
              value,
            ),
          );
        } else {
          whereQuery.push(`${whereKeys[i]} ${this.parseOperator(operator)} ?`);
        }

        whereFinal.push(value);
      } else {
        whereQuery.push(`${whereKeys[i]} = ?`);
        whereFinal.push(whereValue);
      }
    }

    const primaryKeys = await this.db.getPrimaryKeys(tableName);

    const whereResult = await this.db.query(
      `SELECT ${primaryKeys.join(', ')} FROM ${tableName} WHERE ${whereQuery.join(' AND ')}`,
      whereFinal,
    );

    const result = whereResult.map((item: any) => {
      if (primaryKeys.length > 1) {
        return primaryKeys.reduce((acc, key) => {
          acc[key] = item[key];
          return acc;
        }, {} as any);
      } else {
        return item[primaryKeys[0]];
      }
    });

    return result;
  }

  private sortItems(items: DataType[]) {
    const itemsWhere = items.map((item, index) => {
      let wheres = 0;

      for (const key of Object.keys(item)) {
        if (AbstractEntity.isWhere(item, key)) {
          wheres++;
        }
      }

      return {
        item,
        wheres,
      };
    });

    return (itemsWhere as any[])
      .sort((a, b) => a.wheres - b.wheres)
      .map(({ item }) => item);
  }

  private async insertLocales(
    id: number,
    mainTableName: string,
    item: DataType,
  ) {
    const localeColumns: string[] = [];

    for (const key of Object.keys(item)) {
      if (AbstractEntity.isLocale(item, key)) {
        localeColumns.push(key);
      }
    }

    const localeFields: any = {};

    for (const localeColumn of localeColumns) {
      for (const localeField of Object.keys(item[localeColumn])) {
        const localeId = await this.getLocaleId(localeField);

        if (typeof localeFields[localeId] !== 'object') {
          localeFields[localeId] = {};
        }

        localeFields[localeId][localeColumn] = (item[localeColumn] as Locale)[
          localeField
        ];
      }
    }

    for (const localeId of Object.keys(localeFields)) {
      const fields = Object.keys(localeFields[localeId]);

      const tableNameTranslations = this.getLocaleTableName(mainTableName);
      const columnName = await this.db.getColumnNameFromRelation(
        mainTableName,
        tableNameTranslations,
      );

      const query = `INSERT INTO ${tableNameTranslations} (locale_id, ${columnName}, ${fields.join(', ')}) VALUES (${['?', '?', ...fields].map((_) => '?').join(', ')})`;
      const values = [
        Number(localeId),
        id,
        ...Object.values(localeFields[localeId]),
      ];

      try {
        await this.db.query(query, values);
      } catch (error) {
        console.error(chalk.bgRed(`ERROR:`), chalk.red(error), query, values);
      }

      this.eventEmitter.emit(
        'debug',
        `Insert translation of ${this.name} with locale id ${localeId}`,
      );
    }
  }

  private async insert(items: DataType[], tableName = this.name) {
    items = this.sortItems(items);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mainTableName = tableName;
      const mainFields: string[] = [];
      const mainValues: any[] = [];

      /** Insert items */
      for (const key of Object.keys(item)) {
        if (
          !AbstractEntity.isRelation(item, key) &&
          !AbstractEntity.isWhere(item, key) &&
          !AbstractEntity.isLocale(item, key)
        ) {
          mainFields.push(key);
          mainValues.push(item[key]);
        } else if (AbstractEntity.isWhere(item, key)) {
          const whereResult = await this.whereResolve(
            mainTableName,
            (item[key] as any).where,
          );

          let value = null;

          if (whereResult.length === 1) {
            value = whereResult[0];
          }

          mainFields.push(key);
          mainValues.push(value);
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

      this.eventEmitter.emit('debug', `Insert ${mainTableName} with id ${id}`);

      /** Key with locales */
      await this.insertLocales(id, mainTableName, item);

      /** Key relations */
      for (const key of Object.keys(item)) {
        if (AbstractEntity.isRelation(item, key)) {
          for (const tableNameRelation of Object.keys(item[key])) {
            const relationItemKeys = Object.keys(
              (item[key] as any)[tableNameRelation],
            );

            const relationItems = [] as DataType[];

            for (const relationItemKey of relationItemKeys) {
              const relationItem = (item[key] as any)[tableNameRelation][
                relationItemKey
              ];
              if (
                typeof relationItem === 'object' &&
                'where' in relationItem &&
                typeof relationItem.where === 'object'
              ) {
                const relationN2N = await this.db.getRelationN2N(
                  mainTableName,
                  tableNameRelation,
                );

                const foreignIds = await this.whereResolve(
                  tableNameRelation,
                  relationItem.where,
                );

                for (const foreignId of foreignIds) {
                  const query = `INSERT INTO ${relationN2N.tableNameIntermediate} (${relationN2N.columnNameOrigin}, ${relationN2N.columnNameDestination}) VALUES (?, ?)`;
                  const values = [id, foreignId];

                  try {
                    await this.db.query(query, values);
                  } catch (error) {
                    console.error(
                      chalk.bgRed(`ERROR:`),
                      chalk.red(error),
                      query,
                      values,
                    );
                  }

                  this.eventEmitter.emit(
                    'debug',
                    `Insert relation N2N ${mainTableName} with id ${id}`,
                  );
                }
              } else {
                const columnName1N = await this.db.getRelation1N(
                  mainTableName,
                  tableNameRelation,
                );

                relationItem[columnName1N] = id;

                for (const relationItemKey of Object.keys(relationItem)) {
                  if (
                    typeof relationItem[relationItemKey] === 'object' &&
                    'where' in relationItem[relationItemKey] &&
                    typeof relationItem[relationItemKey].where === 'object'
                  ) {
                    const tableNameForeign =
                      await this.db.getTableNameFromForeignKey(
                        tableNameRelation,
                        relationItemKey,
                      );

                    const whereResult = await this.whereResolve(
                      tableNameForeign,
                      relationItem[relationItemKey].where,
                    );

                    let foreignId = null;

                    if (whereResult.length === 1) {
                      foreignId = whereResult[0];
                    }

                    relationItem[relationItemKey] = foreignId;
                  }
                }

                relationItems.push(relationItem);
              }
            }
            await this.insert(relationItems, tableNameRelation as Entity);
          }
        }
      }
    }
  }

  async apply() {
    await this.insert(this.data);
  }
}
