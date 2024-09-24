import chalk = require('chalk');
import * as fs from 'fs';
import * as path from 'path';
import { AbstractAction } from './abstract.action';
import { Input } from '../commands';
import { prettier } from '../lib/utils/formatting';
import { execSync } from 'child_process';

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

    if (!fs.existsSync(packageJsonPath)) {
      console.error(chalk.red('package.json not found.'));
      process.exit(1);
    }

    await this.updatePackageJson(packageJsonPath);
    // const originalAppModule = await this.updateAppModule(appModulePath);
    await this.deletePackageLock(packageLockPath);
    await this.addDependency(dependencyName);

    /* if (originalAppModule) {
      fs.writeFileSync(appModulePath, originalAppModule);
      await prettier(appModulePath);
      console.info(
        chalk.green('Reescreveu o conteúdo atualizado de app.module.ts.'),
      );
    } */
  }

  private async updatePackageJson(packageJsonPath: string) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    const removeHedhogDeps = (deps: { [key: string]: string } | undefined) => {
      if (!deps) return;
      for (const key of Object.keys(deps)) {
        if (key.startsWith('@hedhog') && key !== '@hedhog/prisma') {
          delete deps[key];
        }
      }
    };

    removeHedhogDeps(packageJson.peerDependencies);
    removeHedhogDeps(packageJson.devDependencies);
    removeHedhogDeps(packageJson.dependencies);

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    await prettier(packageJsonPath);

    console.info(
      chalk.blue(
        'Updated package.json and removed @hedhog dependencies (except @hedhog/prisma).',
      ),
    );
  }

  /* private async updateAppModule(appModulePath: string): Promise<string | null> {
    if (!fs.existsSync(appModulePath)) {
      console.error(chalk.red('src/app.module.ts not found.'));
      return null;
    }

    const originalContent = fs.readFileSync(appModulePath, 'utf8');

    originalContent.replace(
      /imports:\s*\[([^\]]+)\]/,
      `imports: [PrismaModule]`,
    );

    console.info(
      chalk.blue(
        'Updated app.module.ts and removed @hedhog modules (except PrismaModule).',
      ),
    );

    return originalContent;
  } */

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
