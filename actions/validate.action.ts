import { existsSync } from 'fs';
import { join } from 'path';
import { Input } from '../commands';
import { getRootPath } from '../lib/utils/get-root-path';
import { loadHedhogFile } from '../lib/utils/load-hedhog-file';
import { AbstractAction } from './abstract.action';
import chalk = require('chalk');

export class ValidateAction extends AbstractAction {
  private rootPath = '';
  private module = '';
  private modulePath = '';

  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    this.module = String(
      inputs.find((input) => input.name === 'module')?.value || '',
    ).toLowerCase();

    this.rootPath = await getRootPath();
    this.modulePath = join(this.rootPath, 'lib', 'libs', this.module);

    if (!existsSync(this.modulePath)) {
      console.error(chalk.red(`Module ${this.module} not found.`));
      return;
    }

    this.showDebug('ValidateAction', {
      inputs,
      options,
      rootPath: this.rootPath,
      module: this.module,
      modulePath: this.modulePath,
    });

    const hedhogFile = await loadHedhogFile(this.modulePath);

    this.showDebug('HedhogFile', hedhogFile);

    console.info(chalk.gray('-----------------------------------------'));

    Object.keys(hedhogFile.tables ?? {}).forEach((table) => {
      console.info('Table:', chalk.yellow(table));
      console.info('Content', (hedhogFile.tables ?? {})[table]);
      console.info(chalk.gray('-----------------------------------------'));
    });

    Object.keys(hedhogFile.data ?? {}).forEach((data) => {
      console.info('Data:', chalk.yellow(data));
      console.info('Content', (hedhogFile.data ?? {})[data]);
      console.info(chalk.gray('-----------------------------------------'));
    });

    Object.keys(hedhogFile.screens ?? {}).forEach((screen) => {
      console.info('Screen:', chalk.yellow(screen));
      console.info('Content', (hedhogFile.screens ?? {})[screen]);
      console.info(chalk.gray('-----------------------------------------'));
    });

    console.info('Routes:', hedhogFile.routes);
    console.info(chalk.gray('-----------------------------------------'));

    Object.keys(hedhogFile.enums ?? {}).forEach((enumName) => {
      console.info('Enum:', chalk.yellow(enumName));
      console.info('Content', (hedhogFile.enums ?? {})[enumName]);
      console.info(chalk.gray('-----------------------------------------'));
    });
  }
}
