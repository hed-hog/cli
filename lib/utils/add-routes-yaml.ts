import { Menu } from '../types/menu';
import { Screen } from '../types/screen';
import { HedhogFile, Route } from '../classes/HedHogFile';
import { join } from 'path';

export const addRoutesToYaml = async (
  libraryPath: string,
  tableName: string,
  hasRelationsWith?: string,
) => {
  try {
    const filePath = join(libraryPath, '..', 'hedhog.yaml');
    const hedhogFile = await new HedhogFile().load(filePath);

    const table = hedhogFile.getTable(tableName);
    const { data } = hedhogFile;

    const primaryKeys = table.columns.filter(
      (column) => column.type === 'pk' || column.isPrimary,
    );

    const primaryKey = primaryKeys.length ? primaryKeys[0].name : 'id';

    const relations = {
      role: [
        {
          where: {
            slug: 'admin',
          },
        },
      ],
    };

    if (!data.route) {
      data.route = [];
    }

    const newRoutes: Route[] = hasRelationsWith
      ? [
          {
            url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}`,
            method: 'GET',
            relations,
          },
          {
            url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}/:${primaryKey}`,
            method: 'GET',
            relations,
          },
          {
            url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}`,
            method: 'POST',
            relations,
          },
          {
            url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}/:${primaryKey}`,
            method: 'PATCH',
            relations,
          },
          {
            url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}`,
            method: 'DELETE',
            relations,
          },
        ]
      : [
          { url: `/${tableName.toKebabCase()}`, method: 'GET', relations },
          { url: `/${tableName.toKebabCase()}`, method: 'POST', relations },
          {
            url: `/${tableName.toKebabCase()}/:${primaryKey}`,
            method: 'GET',
            relations,
          },
          {
            url: `/${tableName.toKebabCase()}/:${primaryKey}`,
            method: 'PATCH',
            relations,
          },
          {
            url: `/${tableName.toKebabCase()}`,
            method: 'DELETE',
            relations,
          },
        ];

    for (const route of newRoutes) {
      if (
        !data.route.some(
          (r: any) => r.url === route.url && r.method === route.method,
        )
      ) {
        data.route.push(route);
      }
    }

    if (!data.menu) {
      data.menu = [];
    }

    const newMenus: Menu[] = [
      {
        name: {
          en: tableName.toPascalCase(),
          pt: tableName.toPascalCase(),
        },
        icon: 'file',
        url: `/${tableName.toKebabCase()}`,
        slug: tableName.toKebabCase(),
        relations,
      },
    ];

    for (const menu of newMenus) {
      if (!data.menu.some((m: any) => m.slug === menu.slug)) {
        data.menu.push(menu);
      }
    }

    if (!data.screen) {
      data.screen = [];
    }

    const newScreens: Screen[] = [
      {
        name: {
          en: tableName.toPascalCase(),
          pt: tableName.toPascalCase(),
        },
        slug: tableName.toKebabCase(),
        description: {
          en: `Screen to manage ${tableName}`,
          pt: `Tela para gerenciar ${tableName}`,
        },
        icon: 'file',
      },
    ];

    for (const screen of newScreens) {
      if (!data.screen.some((s: any) => s.slug === screen.slug)) {
        data.screen.push(screen);
      }
    }

    hedhogFile.data = data;

    await hedhogFile.save();

    console.info(`Routes added to ${filePath}`);
  } catch (error) {
    console.error('Error processing the YAML file:', error);
  }
};
