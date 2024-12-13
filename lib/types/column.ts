import { Locale } from './locale';

export interface Column {
  name: string;
  type: string;
  length?: number;
  isPrimary: boolean;
  locale?: Locale;
  field?: string;
  references?: {
    table: string;
    column: string;
    onDelete: string;
  };
  isNullable?: boolean;
  inputType?: string;
  default?: any;
}
