import { readdir, readFile } from 'fs/promises';
import { getRootPath } from '../lib/utils/get-root-path';
import { AbstractAction } from './abstract.action';
import path = require('path');
import { parse, stringify } from 'yaml';
import { formatWithPrettier } from '../lib/utils/format-with-prettier';

type RouteObject = {
  path: string;
  originalPath?: string;
  component?: string;
  lazy?: {
    component: string;
  };
  children?: RouteObject[];
  content?: string;
};

export class TestAction extends AbstractAction {
  private routes: RouteObject[] = [];
  private routesRecursive: RouteObject[] = [];

  public async handle() {
    const rootPath = await getRootPath();

    const srcPath = path.join(rootPath, 'admin', 'src');
    const routesMainPath = path.join(srcPath, 'routes', 'main.yaml');
    const routesModulesPath = path.join(srcPath, 'routes', 'modules');
    const routePaths = [routesMainPath];

    for (const file of await readdir(routesModulesPath)) {
      routePaths.push(path.join(routesModulesPath, file));
    }

    const routeObjects = [];

    for (const path of routePaths) {
      routeObjects.push(...parse(await readFile(path, 'utf-8'))?.routes);
    }

    await this.extractPathsFromRoutes('', routeObjects);

    this.routes = this.sortRoutes(this.routes);

    this.routesRecursive = this.buildRoutesTree(this.routes);

    this.routesRecursive = this.applyOriginalPathsRecursive(
      this.routesRecursive,
    );

    const varTemplate = `${this.convertToString(this.routesRecursive)
      .map((route) => route.content)
      .join(',')}`;

    console.log(
      await formatWithPrettier(varTemplate, {
        parser: 'typescript',
      }),
    );
  }

  applyOriginalPathsRecursive(routes: RouteObject[]) {
    return this.removeDuplicates(
      routes.map((route) => {
        if (route.children) {
          route.children = this.applyOriginalPathsRecursive(route.children);
        }

        if (route.originalPath) {
          route.path = route.originalPath;
        }

        delete route.originalPath;

        if (route.children?.length === 0) {
          delete route.children;
        }

        return route;
      }),
    );
  }

  convertToString(routes: RouteObject[]) {
    return routes.map((route) => {
      const lines = [];

      lines.push(`path: '${route.path}'`);

      if (route.lazy) {
        lines.push(
          `lazy: async () => ({ Component: (await import('${route.lazy.component}')).default})`,
        );
      }

      if (route.children) {
        route.children = this.convertToString(route.children);

        const childrenContent = route.children.map((child) => child.content);

        lines.push(`children: [${childrenContent.join(',\n')}]`);
      }

      route.content = `{ ${lines.join(',')} }`;

      return route;
    });
  }

  removeDuplicates(routes: RouteObject[]): RouteObject[] {
    const map = new Map<string, RouteObject>();

    for (const route of routes) {
      const existingRoute = map.get(route.path);

      if (existingRoute) {
        // Se já existe uma rota com este 'path', decidir qual manter
        if (existingRoute.children) {
          // Se a rota existente já tem 'children', mantê-la
          continue;
        } else if (route.children) {
          // Se a nova rota tem 'children', substituir a existente
          map.set(route.path, route);
        }
        // Se nenhuma das rotas tem 'children', manter a existente
      } else {
        // Se não existe uma rota com este 'path', adicioná-la
        map.set(route.path, route);
      }
    }

    return Array.from(map.values());
  }

  sortRoutes(routeObjects: RouteObject[]) {
    return routeObjects.sort((a, b) => {
      if (a.path === null) {
        return -1;
      }

      if (b.path === null) {
        return 1;
      }

      if (a.path < b.path) {
        return -1;
      }
      if (a.path > b.path) {
        return 1;
      }
      return 0;
    });
  }

  async extractPathsFromRoutes(
    parentPath: string,
    routeObjects: RouteObject[],
  ) {
    for (const routeObject of routeObjects) {
      const fullPath = [parentPath, routeObject.path]
        .join('/')
        .replaceAll('//', '/');

      if (routeObject?.children) {
        await this.extractPathsFromRoutes(fullPath, routeObject?.children);
      }

      const newRouteObject: RouteObject = {
        path: fullPath,
        originalPath: routeObject.path,
        component: routeObject.component,
        lazy: routeObject.lazy,
      };

      if (!this.routes.map((route) => route.path).includes(fullPath)) {
        this.routes.push(newRouteObject);
      }
    }
  }

  private buildRoutesTree(flatRoutes: RouteObject[]): RouteObject[] {
    const routeTree: RouteObject[] = [];

    for (const route of flatRoutes) {
      const path = route.path;
      const isIndexRoute = path.endsWith('/');
      const segments = path.split('/').filter((segment) => segment.length > 0);
      this.insertRoute(route, segments, routeTree, isIndexRoute);
    }

    return routeTree;
  }

  private insertRoute(
    route: RouteObject,
    segments: string[],
    routes: RouteObject[],
    isIndexRoute: boolean,
  ) {
    if (segments.length === 0) {
      // Rota raiz
      if (!routes.map((r) => r.path).includes(route.path)) {
        routes.push(route);
      }
      return;
    }

    const [currentSegment, ...remainingSegments] = segments;
    let node = routes.find((r) => r.path === currentSegment);

    if (!node) {
      node = { path: currentSegment, children: [] } as unknown as RouteObject;
      if (!routes.map((r) => r.path).includes(node.path)) {
        routes.push(node);
      }
    }

    if (remainingSegments.length === 0) {
      if (isIndexRoute) {
        // Rota de índice
        if (!node.children) {
          node.children = [];
        }
        const indexRoute = { ...route, path: '', index: true };
        if (!node.children.map((r) => r.path).includes(indexRoute.path)) {
          node.children.push(indexRoute);
        }
      } else {
        // Rota final
        Object.assign(node, route);
      }
    } else {
      if (!node.children) {
        node.children = [];
      }
      this.insertRoute(route, remainingSegments, node.children, isIndexRoute);
    }
  }
}
