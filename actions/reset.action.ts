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

export class ResetAction extends AbstractAction {
  public async handle() {
    console.log(chalk.yellow('Resetting the project...'));

    const directoryPath = process.cwd();

    await this.removeMigrations(directoryPath);
    await this.removeDependencies(directoryPath);
    await this.recreateAppModule(directoryPath);
    await this.checkEnvFile(directoryPath);
    await this.recreateDatabase(directoryPath);

    console.log(chalk.green('Project reset successfully.'));
  }

  async checkEnvFile(path: string) {
    const spinner = ora('Check .env file...').start();
    const envPath = join(path, '.env');

    if (!existsSync(envPath)) {
      writeFile(
        envPath,
        `
DB_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=hedhog
DB_PASSWORD=changeme
DB_DATABASE=hedhog

DATABASE_URL=\${DB_TYPE}://\${DB_USERNAME}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_DATABASE}
`,
        'utf-8',
      );
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
        if ((await lstat(currentPath)).isDirectory()) {
          await this.unlinkDirectoryRecursive(currentPath);
        } else {
          await unlink(currentPath);
        }
      }

      await rmdir(path);

      return true;
    } else {
      return false;
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
      spinner.succeed('App module recreated.');
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
          env[key] = value.replaceAll(/['"]+/g, '');
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
