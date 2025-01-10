import { join } from 'node:path';
import { HedhogFile, Route } from '../classes/HedHogFile';
import { Menu } from '../types/menu';
import { Screen } from '../types/screen';
import { existsSync } from 'node:fs';

/**
 * Adds routes, menus, and screens to the `hedhog.yaml` file for a specific table.
 *
 * This function updates the `hedhog.yaml` file by adding routes, menus, and screens
 * for the specified table. If relations are provided, it associates the routes with
 * the related table.
 *
 * @param {string} libraryPath - The path to the library directory where the `hedhog.yaml` file is located.
 * @param {string} tableName - The name of the table for which routes, menus, and screens are to be added.
 * @param {string} [hasRelationsWith] - Optional. The name of the related table to associate with the routes.
 *
 * @returns {Promise<void>} - A promise that resolves when the YAML file is successfully updated, or rejects with an error.
 */
export const addRoutesToYaml = async (
  libraryPath: string,
  tableName: string,
  hasRelationsWith?: string,
): Promise<void> => {
  try {
    const filePath = join(libraryPath, '..', 'hedhog.yaml');

    console.log({ exists: existsSync(filePath) });

    const hedhogFile = await new HedhogFile().load(filePath);

    const table = hedhogFile.getTable(tableName);
    console.log({ filePath, hedhogFile, table });
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
