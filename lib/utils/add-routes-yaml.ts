import * as fs from 'fs';
import * as yaml from 'yaml';
import path = require('path');
import { Menu } from '../types/menu';
import { Screen } from '../types/screen';

interface Route {
  url: string;
  method: string;
  relations?: any;
}

interface HedhogData {
  route?: Route[];
  menu?: Menu[];
  screen?: Screen[];
}

interface HedhogYaml {
  data?: HedhogData;
}

export const addRoutesToYaml = (
  libraryPath: string,
  tableName: string,
  hasRelationsWith?: string,
): void => {
  try {
    const filePath = path.join(libraryPath, '..', 'hedhog.yaml');
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const yamlData: HedhogYaml = yaml.parse(fileContents) as HedhogYaml;

    const relations = {
      role: [
        {
          where: {
            slug: 'admin',
          },
        },
      ],
    };

    if (!yamlData.data) {
      yamlData.data = {};
    }

    if (!yamlData.data.route) {
      yamlData.data.route = [];
    }

    const newRoutes: Route[] = hasRelationsWith
      ? [
          {
            url: `/${hasRelationsWith}/:${hasRelationsWith}Id/${tableName.split('_')[1]}`,
            method: 'GET',
            relations,
          },
          {
            url: `/${hasRelationsWith}/:${hasRelationsWith}Id/${tableName.split('_')[1]}`,
            method: 'POST',
            relations,
          },
          {
            url: `/${hasRelationsWith}/:${hasRelationsWith}Id/${tableName.split('_')[1]}/:${tableName.split('_')[1]}Id`,
            method: 'PATCH',
            relations,
          },
          {
            url: `/${hasRelationsWith}/:${hasRelationsWith}Id/${tableName.split('_')[1]}`,
            method: 'DELETE',
            relations,
          },
        ]
      : [
          { url: `/${tableName.toKebabCase()}`, method: 'GET', relations },
          { url: `/${tableName.toKebabCase()}`, method: 'POST', relations },
          { url: `/${tableName.toKebabCase()}/:id`, method: 'GET', relations },
          {
            url: `/${tableName.toKebabCase()}/:id`,
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
        !yamlData.data.route.some(
          (r) => r.url === route.url && r.method === route.method,
        )
      ) {
        yamlData.data.route.push(route);
      }
    }

    if (!yamlData.data.menu) {
      yamlData.data.menu = [];
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
      if (!yamlData.data.menu.some((m) => m.slug === menu.slug)) {
        yamlData.data.menu.push(menu);
      }
    }

    if (!yamlData.data.screen) {
      yamlData.data.screen = [];
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
      if (!yamlData.data.screen.some((s) => s.slug === screen.slug)) {
        yamlData.data.screen.push(screen);
      }
    }

    const newYamlContent = yaml.stringify(yamlData);
    fs.writeFileSync(filePath, newYamlContent, 'utf8');
    console.info(`Routes added to ${filePath}`);
  } catch (error) {
    console.error('Error processing the YAML file:', error);
  }
};
