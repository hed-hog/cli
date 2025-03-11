export type HedhogTableColumnLocaleCode = string;

export type HedhogTableName = string;

export type HedhogTableColumnName = string;

export type HedhogTableColumnValue = any;

export type HedhogLocaleField = {
  [key: HedhogTableColumnLocaleCode]: string;
};

export type HedhogTableColumnBase = {
  name?: string;
  length?: string;
  isNullable?: boolean;
  locale?: HedhogLocaleField;
};

export type HedhogTableColumnFkOnDelete =
  | 'CASCADE'
  | 'RESTRICT'
  | 'NO ACTION'
  | 'SET NULL';

export type HedhogTableColumnFkOnUpdate = HedhogTableColumnFkOnDelete;

export type HedhogTableColumn = HedhogTableColumnBase &
  (
    | {
        type: 'pk';
      }
    | {
        type: 'fk';
        references: {
          table: string;
          column: string;
          onDelete?: HedhogTableColumnFkOnDelete;
          onUpdate?: HedhogTableColumnFkOnUpdate;
        };
      }
    | {
        type: 'slug';
      }
    | {
        type: 'enum';
        enum: string[];
      }
    | {
        type: 'created_at';
      }
    | {
        type: 'updated_at';
      }
    | {
        type: 'varchar';
      }
    | {
        type: 'datetime';
      }
    | {
        type: 'array';
        of: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'time';
      }
    | {
        type: 'order';
      }
    | {
        type: 'int';
      }
    | {
        type: 'text';
      }
    | {
        type: 'boolean';
      }
    | {
        type: 'char';
      }
    | {
        type: 'decimal';
        precision: number;
        scale: number;
      }
    | {
        type: 'tinyint';
      }
    | {
        type: 'json';
      }
  );

export type HedhogTable = {
  columns: HedhogTableColumn[];
  indices?: {
    columns: string[];
    isUnique?: boolean;
  }[];
  ifNotExists?: boolean;
};

export type HedhogData = {
  [key: HedhogTableColumnName]: HedhogTableColumnValue;
};

export type HedhogFieldWhere = {
  where: Record<string, HedhogTableColumnValue>;
};

export type HedhogDataColumnForeignKey =
  | number
  | string
  | null
  | HedhogFieldWhere;

export type HedhogDataMenuRelations = {
  [key: HedhogTableName]: HedhogFieldWhere[];
};

export type HedhogMenu = {
  menu_id?: HedhogDataColumnForeignKey;
  name: HedhogLocaleField;
  icon: string;
  url: string;
  slug: string;
  relations?: HedhogDataMenuRelations;
};

export type HedhogScreen = {
  title: HedhogLocaleField;
  menu?: HedhogMenu;
};

export type HedhogRoute = {
  path: string;
  lazy?: {
    component: string;
  };
  children?: HedhogRoute[];
};

export type HedhogEnum = {
  key: string;
  value: string;
};

export type HedhogFile = {
  tables?: Record<HedhogTableName, HedhogTable>;
  data?: Record<HedhogTableName, HedhogData[]>;
  screens?: Record<string, HedhogScreen>;
  routes?: HedhogRoute[];
  enums?: Record<HedhogTableName, HedhogEnum>;
};
