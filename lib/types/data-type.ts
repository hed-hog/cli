import { DataHash } from './data-hash';
import { DataRelation } from './data-relation';
import { DataWhere } from './data-where';
import { Locale } from './locale';

export type DataType = {
  relations?: DataRelation[];
} & {
  [key: string]: string | number | boolean | Locale | DataWhere | DataHash;
};
