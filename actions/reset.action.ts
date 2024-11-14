import chalk = require('chalk');
import { AbstractAction } from './abstract.action';
import * as ora from 'ora';
import { existsSync } from 'fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from 'fs/promises';
import { join } from 'path';
import { getFileContent } from '../lib/utils/get-file-content';
import { EMOJIS } from '../lib/ui';
import { testDatabaseConnection } from '../lib/utils/test-database-connection';
import { recreateDatabase } from '../lib/utils/recreate-database';
import { getEnvFileTemplate } from '../lib/utils/env-file-template';
import { getRootPath } from '../lib/utils/get-root-path';
import { createPrismaSchema } from '../lib/utils/create-prisma-schema';

export class ResetAction extends AbstractAction {
  public async handle() {
    console.info(chalk.yellow('Resetting the project...'));

    let directoryPath = '';

    try {
      directoryPath = await getRootPath();
      directoryPath = join(directoryPath, 'backend');
    } catch (error) {
      return console.error(chalk.red('Directory is not a hedhog project.'));
    }

    await this.removeMigrations(directoryPath);
    await this.removeDependencies(directoryPath);
    await this.recreateAppModule(directoryPath);
    await this.recreatePrismaSchema(directoryPath);
    await this.checkEnvFile(directoryPath);
    await this.recreateDatabase(directoryPath);
    await this.resetAdminFrontEnd(directoryPath);

    console.info(chalk.green('Project reset successfully.'));
  }

  async resetAdminFrontEnd(path: string) {
    const spinner = ora('Reset Admin Frontend...').start();
    const adminPath = join(path, '..', 'admin');

    if (existsSync(adminPath)) {
      const routesPath = join(adminPath, 'src', 'routes.json');
      const routesJSON = require(routesPath);
      const adminRoutes = (routesJSON?.routes ?? [])
        .map((route: any) => route?.path ?? '')
        .filter((route: string) => route !== '');

      for (const module of adminRoutes) {
        for (const dir of ['pages', 'features']) {
          spinner.info(`Clearing ${dir}/${module}...`);
          this.unlinkDirectoryRecursive(join(adminPath, 'src', dir, module));
        }
      }

      const moduleRoutesPath = join(adminPath, 'src', 'routes', 'modules');
      if (existsSync(moduleRoutesPath)) {
        spinner.info('Clearing routes/modules...');
        this.unlinkDirectoryRecursive(moduleRoutesPath);
      }

      await writeFile(
        routesPath,
        JSON.stringify({ routes: [] }, null, 2),
        'utf-8',
      );

      spinner.succeed('Admin Frontend cleared.');
    } else {
      spinner.warn('No Admin Frontend found.');
    }
  }

  async checkEnvFile(path: string) {
    const spinner = ora('Check .env file...').start();
    const envPath = join(path, '.env');

    if (!existsSync(envPath)) {
      await writeFile(envPath, getEnvFileTemplate(), 'utf-8');
      spinner.succeed('Environment file created.');
    } else {
      spinner.succeed('Environment file found.');
    }
  }

  async unlinkDirectoryRecursive(path: string) {
    if (existsSync(path)) {
      const files = await readdir(path);

      for (const file of files) {
        const currentPath = join(path, file);
        if (
          existsSync(currentPath) &&
          (await lstat(currentPath)).isDirectory()
        ) {
          await this.unlinkDirectoryRecursive(currentPath);
        } else {
          if (existsSync(currentPath)) {
            await unlink(currentPath);
          }
        }
      }

      await rmdir(path);

      return true;
    } else {
      return false;
    }
  }

  async recreatePrismaSchema(path: string) {
    const spinner = ora('Recreate Prisma Schema').start();
    try {
      const envVars = await this.parseEnvFile(join(path, '.env'));

      const database = String(envVars.DATABASE_URL).split(':')[0] as
        | 'postgres'
        | 'mysql';

      await createPrismaSchema(
        join(path, 'src', 'prisma'),
        database === 'mysql' ? 'mysql' : 'postgres',
      );
      spinner.succeed('Prisma Schema created.');
    } catch (error) {
      spinner.fail('Failed to recreate Prisma Schema.');
      console.error(error);
    }
  }

  async recreateAppModule(path: string) {
    const spinner = ora('Recreate app.module.ts...').start();
    try {
      const appModulePath = join(path, 'src', 'app.module.ts');

      if (existsSync(appModulePath)) {
        await unlink(appModulePath);
      }

      const bootstrapContent = await getFileContent(
        'https://raw.githubusercontent.com/hed-hog/bootstrap/refs/heads/master/backend/src/app.module.ts',
      );

      await writeFile(appModulePath, bootstrapContent, 'utf-8');
      spinner.succeed('AppModule created.');
    } catch (error) {
      spinner.fail('Failed to recreate app.module.ts.');
      console.error(error);
    }
  }

  async removeMigrations(path: string) {
    const spinner = ora('Remove migrations...').start();
    const migrationsPath = join(path, `src`, `typeorm`, `migrations`);

    if (existsSync(migrationsPath)) {
      await this.unlinkDirectoryRecursive(migrationsPath);
      spinner.succeed('Migrations cleared.');
      await mkdir(migrationsPath, { recursive: true });
    } else {
      spinner.warn('No migrations found.');
    }
  }

  async removeDependencies(path: string) {
    const spinner = ora('Remove dependencies...').start();
    const packageJsonPath = join(path, 'package.json');

    const hedhogDependencies = [];
    const excludedDependencies = ['@hedhog/prisma'];

    if (existsSync(packageJsonPath)) {
      const packageJson = require(packageJsonPath);

      for (const dep in packageJson.dependencies) {
        if (dep.includes('@hedhog') && !excludedDependencies.includes(dep)) {
          hedhogDependencies.push(dep);
        }
      }

      if (hedhogDependencies.length > 0) {
        hedhogDependencies.forEach(async (dep) => {
          delete packageJson.dependencies[dep];
        });

        await writeFile(
          packageJsonPath,
          JSON.stringify(packageJson, null, 2),
          'utf-8',
        );

        spinner.succeed('Dependencies cleared.');
      } else {
        spinner.warn('No HedHog dependencies found.');
      }
    } else {
      spinner.warn('No package.json found.');
    }
  }

  async parseEnvFile(envPath: string) {
    if (existsSync(envPath)) {
      const envFile = await readFile(envPath, 'utf-8');
      const envLines = envFile.split('\n');

      const env: any = {};

      for (const line of envLines) {
        const [key, value] = line.split('=');
        if (key && value) {
          env[key.trim()] = value.trim().replace(/['"\r]+/g, '');
        }
      }

      return env;
    } else {
      console.error(chalk.red(`${EMOJIS.ERROR} File .env not found.`));
    }
  }

  async recreateDatabase(path: string) {
    const spinner = ora('Start recreating database...').start();
    const envVars = await this.parseEnvFile(join(path, '.env'));

    if (
      envVars.DATABASE_URL &&
      envVars.DB_HOST &&
      envVars.DB_PORT &&
      envVars.DB_USERNAME &&
      envVars.DB_PASSWORD &&
      envVars.DB_DATABASE
    ) {
      const type = envVars.DATABASE_URL.split(':')[0] as 'postgres' | 'mysql';

      const isDbConnected = await testDatabaseConnection(
        type,
        envVars.DB_HOST,
        Number(envVars.DB_PORT),
        envVars.DB_USERNAME,
        envVars.DB_PASSWORD,
        envVars.DB_DATABASE,
      );

      if (isDbConnected) {
        spinner.info('Recreating database...');
        await recreateDatabase(
          type,
          envVars.DB_HOST,
          Number(envVars.DB_PORT),
          envVars.DB_USERNAME,
          envVars.DB_PASSWORD,
          envVars.DB_DATABASE,
        );
        spinner.succeed('Database recreated.');
      } else {
        spinner.fail('Failed to connect to the database.');
      }
    }
  }
}
