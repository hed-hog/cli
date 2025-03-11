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

    this.showDebug('-----------------------------------------');

    Object.keys(hedhogFile.tables ?? {}).forEach((table) => {
      this.showDebug('Table', table);
      this.showDebug('Content', (hedhogFile.tables ?? {})[table]);
      this.showDebug('-----------------------------------------');
    });
  }
}
