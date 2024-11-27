import { Table } from '../types/table';
import { HedhogFile } from './HedHogFile';
import { TableApply } from './TableApply';

export class TableFactory {
  static async create(table: Table, hedhogPath: string) {
    const hedhogFile = await new HedhogFile().load(hedhogPath);
    const tableApply = new TableApply(table);
    await tableApply.setHedhogFile(hedhogFile);
    return tableApply;
  }
}
