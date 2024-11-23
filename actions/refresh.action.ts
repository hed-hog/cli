import chalk = require('chalk');
import * as fs from 'fs';
import * as path from 'path';
import { AbstractAction } from './abstract.action';
import { Input } from '../commands';
import { prettier } from '../lib/utils/formatting';
import { execSync } from 'child_process';
import { formatWithPrettier } from '../lib/utils/format-with-prettier';

export class RefreshAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    const dependencyName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    );

    if (!dependencyName.length) {
      console.error(chalk.red('You must provide a dependency name.'));
      process.exit(1);
    }

    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const appModulePath = path.join(process.cwd(), 'src/app.module.ts');
    const packageLockPath = path.join(process.cwd(), 'package-lock.json');
    const migrationsPath = path.join(process.cwd(), 'src/typeorm/migrations');

    if (!fs.existsSync(packageJsonPath)) {
      console.error(chalk.red('package.json not found.'));
      process.exit(1);
    }

    this.deleteMigrationsFiles(migrationsPath);
    await this.updatePackageJson(packageJsonPath);
    await this.updateAppModule(appModulePath);
    await this.deletePackageLock(packageLockPath);
    await this.addDependency(dependencyName);
  }

  private deleteMigrationsFiles(migrationsPath: string) {
    if (fs.existsSync(migrationsPath)) {
      const files = fs.readdirSync(migrationsPath);
      for (const file of files) {
        const filePath = path.join(migrationsPath, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
          console.info(`Deleted file: ${filePath}`);
        }
      }
    } else {
      console.error(`Folder not found: ${migrationsPath}`);
    }
  }

  private async updatePackageJson(packageJsonPath: string) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    const removeHedhogDeps = (deps: { [key: string]: string } | undefined) => {
      if (!deps) return;
      for (const key of Object.keys(deps)) {
        if (
          key.startsWith('@hedhog') &&
          key !== '@hedhog/prisma' &&
          key !== '@hedhog/utils' &&
          key !== '@hedhog/core'
        ) {
          delete deps[key];
        }
      }
    };

    removeHedhogDeps(packageJson.peerDependencies);
    removeHedhogDeps(packageJson.devDependencies);
    removeHedhogDeps(packageJson.dependencies);

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    await formatWithPrettier(packageJsonPath, {
      parser: 'json',
    });

    console.info(
      chalk.blue(
        'Updated package.json and removed @hedhog dependencies (except @hedhog/prisma).',
      ),
    );
  }

  private async updateAppModule(appModulePath: string) {
    if (!fs.existsSync(appModulePath)) {
      console.error(chalk.red('src/app.module.ts not found.'));
      return null;
    }
    const fileContent = fs.readFileSync(appModulePath, 'utf8');

    const updatedContent = fileContent
      .replace(/imports:\s*\[([^\]]+)\]/, `imports: [PrismaModule]`)
      .replace(/import\s*{[^}]*}\s*from\s*'@hedhog\/(?!prisma)[^']*';\n?/g, '');

    fs.writeFileSync(appModulePath, updatedContent, 'utf8');

    console.info(
      chalk.blue(
        'Updated app.module.ts and removed @hedhog modules (except PrismaModule).',
      ),
    );
  }

  private async deletePackageLock(packageLockPath: string) {
    if (fs.existsSync(packageLockPath)) {
      fs.unlinkSync(packageLockPath);
      console.info(chalk.blue('Deleted package-lock.json.'));
    } else {
      console.warn(
        chalk.yellow('package-lock.json not found, skipping deletion.'),
      );
    }
  }

  private async addDependency(dependencyName: string) {
    try {
      console.info(chalk.blue(`Adding dependency ${dependencyName}...`));
      execSync(`hedhog add ${dependencyName}`, { stdio: 'inherit' });
      console.info(chalk.green(`Successfully added ${dependencyName}.`));
    } catch (error) {
      console.error(
        chalk.red(`Failed to add ${dependencyName}: ${error.message}`),
      );
      process.exit(1);
    }
  }
}
