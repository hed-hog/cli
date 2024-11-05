import chalk = require('chalk');
import { AbstractAction } from './abstract.action';
import * as ora from 'ora';
import { join } from 'path';
import { getRootPath } from '../lib/utils/get-root-path';
import { Input } from '../commands';
import { createPromptModule } from 'inquirer';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { mkdirRecursive } from '../lib/utils/checkVersion';
import { readFile, writeFile } from 'fs/promises';
import { parse, stringify } from 'yaml';
import { createOpenIAAssistent } from '../lib/utils/create-openia-assistent';
import { render } from 'ejs';
import { saveConfig } from '../lib/utils/save-config';
import { getConfig } from '../lib/utils/get-config';

export class ConfigureAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    this.showDebug({
      options,
    });

    let directoryPath = '';

    try {
      directoryPath = await getRootPath();
    } catch (error) {
      return console.error(chalk.red('Directory is not a hedhog project.'));
    }

    this.showDebug({
      directoryPath,
    });

    let openiaToken = '';

    if (options.some((option) => option.name === 'openiaToken')) {
      const openiaOption = options.find(
        (option) => option.name === 'openiaToken',
      );
      if (openiaOption) {
        openiaToken = openiaOption.value as string;
      }
    }

    if (!openiaToken) {
      openiaToken = await this.askForOpenIAToken();
    }

    this.showDebug({
      openiaToken,
    });

    await this.saveConfig(openiaToken);
  }

  getDotHedhogPath() {
    return join(homedir(), '.hedhog');
  }

  getConfigPath() {
    return join(this.getDotHedhogPath(), 'config.yaml');
  }

  async saveConfig(openiaToken: string) {
    //const spinner = ora('Saving configuration').start();

    try {
      await this.createDirecotyDotHedhog();

      const assistenteInstructions = render(
        await readFile(
          join(__dirname, '..', 'templates', 'assistent.ejs'),
          'utf-8',
        ),
      );

      await saveConfig({ tokens: { OPENIA: openiaToken } });

      const currentAssistentApplyLocaleId = await getConfig(
        'assistents.applyLocale',
      );

      if (currentAssistentApplyLocaleId) {
        try {
          await createOpenIAAssistent(currentAssistentApplyLocaleId);
        } catch (error) {
          console.error(
            chalk.red(`Could not create OpenIA assistent: ${error.message}`),
          );
        }
      }

      try {
        const assistent = await createOpenIAAssistent({
          description: 'Hedhog CLI - Locales',
          instructions: assistenteInstructions,
          name: 'hedhog-cli',
          response_format: {
            type: 'json_object',
          },
          model: 'gpt-4o-mini',
        });

        await saveConfig({ assistents: { applyLocale: assistent.id } });
      } catch (error) {
        console.error(
          chalk.red(`Could not create OpenIA assistent: ${error.message}`),
        );
      }

      //spinner.succeed(`Configuration saved to ${this.getConfigPath()}`);
    } catch (error) {
      //spinner.fail();
      return console.error(
        chalk.red(`Could not save configuration: ${error.message}`),
      );
    }
  }

  async askForOpenIAToken(): Promise<string> {
    const answer = await createPromptModule({
      output: process.stderr,
      input: process.stdin,
    })({
      type: 'password',
      name: 'token',
      message: `Please enter your OpenIA token:`,
    });

    return answer.token;
  }

  async createDirecotyDotHedhog() {
    const userDirPath = join(homedir(), '.hedhog');

    if (!existsSync(userDirPath)) {
      const spinner = ora('Creating .hedhog directory').start();

      try {
        await mkdirRecursive(userDirPath);
        spinner.succeed();
      } catch (error) {
        spinner.fail();
        return console.error(
          chalk.red(
            'Could not create .hedhog directory in your home directory.',
          ),
        );
      }
    }
  }
}
