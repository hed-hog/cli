import { DataWhere } from './data-where';

export type DataRelation = {
  [key: string]: string | number | DataWhere;
};
