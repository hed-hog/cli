import chalk = require('chalk');
import * as bcrypt from 'bcryptjs';
import { AbstractDatabase } from '../databases';
import { DataHash } from '../types/data-hash';
import { DataType } from '../types/data-type';
import { Locale } from '../types/locale';
import EventEmitter = require('events');

export class AbstractEntity {
  private locale: { [key: string]: number } = {};
  private eventEmitter = new EventEmitter();

  constructor(
    protected db: AbstractDatabase,
    protected name: string,
    protected data: DataType[],
  ) {}

  on(event: string, listener: (...args: any[]) => void) {
    return this.eventEmitter.on(event, listener);
  }

  static isRelation(item: DataType, key: string) {
    return key === 'relations' && typeof item[key] === 'object';
  }

  static isWhere(item: DataType, key: string) {
    return (
      typeof item[key] === 'object' &&
      'where' in item[key] &&
      typeof item[key].where === 'object'
    );
  }

  static isLocale(item: DataType, key: string) {
    return (
      typeof item[key] === 'object' &&
      this.countKeyLength(item[key] as Locale).length === 1 &&
      this.countKeyLength(item[key] as Locale)[0] === 2
    );
  }

  static isHash(item: DataType, key: string) {
    return (
      typeof item[key] === 'object' &&
      'hash' in item[key] &&
      typeof item[key].hash === 'string'
    );
  }

  static countKeyLength(item: Locale) {
    return [...new Set(Object.keys(item).map((key) => key.length))];
  }

  private getLocaleTableName(mainTableName: string) {
    const mainTableNameSplitted = mainTableName.split('_');
    const lastName = mainTableNameSplitted.pop() as string;
    const firstName = mainTableNameSplitted.join('_');
    const translations_suffix = 'locale';

    return !firstName
      ? `${lastName}_${translations_suffix}`
      : `${firstName}_${lastName}_${translations_suffix}`;
  }

  private async getLocaleId(code: string) {
    if (this.locale[code]) {
      return this.locale[code];
    }

    const locale = await this.db.query('SELECT id FROM locale WHERE code = ?', [
      code,
    ]);

    if (!locale.length) {
      throw new Error(`Locale with code "${code}" not found.`);
    }

    return (this.locale[code] = locale[0].id);
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

  private async whereResolve(
    tableName: string,
    where: Record<string, any>,
    field?: string,
  ) {
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);
    const whereQuery = [] as string[];
    const whereFinal = [] as any[];

    for (let i = 0; i < whereKeys.length; i++) {
      const whereValue = whereValues[i];
      const whereField = whereKeys[i];

      if (typeof whereValue === 'object') {
        const operator = Object.keys(whereValue)[0];

        let value: string = whereValue[operator] as string;

        if (['in', 'nin'].includes(operator) && Array.isArray(value)) {
          whereQuery.push(
            this.db.getWhereWithIn(whereField, operator as 'in' | 'nin', value),
          );
        } else {
          whereQuery.push(
            `${this.db.getColumnNameWithScaping(whereField)} ${this.parseOperator(operator)} ?`,
          );
        }

        whereFinal.push(value);
      } else {
        whereQuery.push(`${this.db.getColumnNameWithScaping(whereField)} = ?`);
        whereFinal.push(whereValue);
      }
    }

    const primaryKeys = await this.db.getPrimaryKeys(tableName);

    let whereTable = tableName;

    if (field) {
      whereTable = await this.db.getTableNameFromForeignKey(tableName, field);
    }

    const whereResult = await this.db.query(
      `SELECT ${primaryKeys.map((pk) => this.db.getColumnNameWithScaping(pk)).join(', ')} FROM ${this.db.getColumnNameWithScaping(whereTable)} WHERE ${whereQuery.join(' AND ')}`,
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

      const query = `INSERT INTO ${tableNameTranslations} (locale_id, ${this.db.getColumnNameWithScaping(columnName)}, ${fields.map((f) => this.db.getColumnNameWithScaping(f)).join(', ')}) VALUES (${['?', '?', ...fields].map((_) => '?').join(', ')})`;
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

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  }

  private async insert(items: DataType[], tableName = this.name) {
    items = this.sortItems(items);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mainTableName = tableName;
      const mainFields: string[] = [];
      const mainValues: any[] = [];

      this.eventEmitter.emit(
        'debug',
        `Insert ${mainTableName} with data ${JSON.stringify(item)}`,
      );

      /** Insert items */
      for (const key of Object.keys(item)) {
        if (
          !AbstractEntity.isRelation(item, key) &&
          !AbstractEntity.isWhere(item, key) &&
          !AbstractEntity.isLocale(item, key) &&
          !AbstractEntity.isHash(item, key)
        ) {
          mainFields.push(key);
          mainValues.push(item[key]);
        } else if (AbstractEntity.isWhere(item, key)) {
          const whereResult = await this.whereResolve(
            mainTableName,
            (item[key] as any).where,
            key,
          );

          let value = null;

          if (whereResult.length === 1) {
            value = whereResult[0];
          }

          mainFields.push(key);
          mainValues.push(value);
        } else if (AbstractEntity.isHash(item, key)) {
          const value = await this.hashPassword((item[key] as DataHash).hash);

          mainFields.push(key);
          mainValues.push(value);
        }
      }

      const primaryKeys = await this.db.getPrimaryKeys(mainTableName);

      this.eventEmitter.emit('debug', {
        mainTableName,
        mainFields,
        mainValues,
        primaryKeys,
      });

      const columnNameOrder = 'order';

      if (
        !mainFields.includes(columnNameOrder) &&
        (await this.db.hasTableColumnOrder(mainTableName))
      ) {
        const columnName = await this.db.getColumnNameFromRelation(
          mainTableName,
          mainTableName,
        );

        const valueIndex = mainFields.indexOf(columnName);

        const lastOrderResult = await this.db.query(
          `SELECT ${this.db.getColumnNameWithScaping(columnNameOrder)} FROM ${mainTableName} WHERE ${this.db.getColumnNameWithScaping(columnName)} ${mainValues[valueIndex] === undefined ? 'IS NULL' : `= ?`} ORDER BY ${this.db.getColumnNameWithScaping(columnNameOrder)} DESC LIMIT 1`,
          mainValues[valueIndex] === undefined ? [] : [mainValues[valueIndex]],
        );

        const currentOrder = lastOrderResult[0]?.order ?? -1;

        mainFields.push(columnNameOrder);
        mainValues.push(currentOrder + 1);
        this.eventEmitter.emit('debug', {
          lastOrder: currentOrder,
          nextOrder: currentOrder + 1,
          tableName,
        });
      }

      const id = (
        await this.db.query(
          `INSERT INTO ${this.db.getColumnNameWithScaping(mainTableName)} (${mainFields.map((f) => this.db.getColumnNameWithScaping(f)).join(', ')}) VALUES (${mainValues.map((_) => '?').join(', ')})`,
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
                  this.eventEmitter.emit('debug', {
                    relationN2N,
                  });

                  const query = `INSERT INTO ${this.db.getColumnNameWithScaping(relationN2N.tableNameIntermediate)} (${this.db.getColumnNameWithScaping(relationN2N.columnNameOrigin)}, ${this.db.getColumnNameWithScaping(relationN2N.columnNameDestination)}) VALUES (?, ?)`;
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
            await this.insert(relationItems, tableNameRelation);
          }
        }
      }
    }
  }

  async apply() {
    await this.insert(this.data);
  }
}
