import { Column } from './column';

export interface Table {
  name: string;
  columns: Column[];
  ifNotExists: boolean;
}
