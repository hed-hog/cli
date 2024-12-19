import { Command } from '@commander-js/extra-typings';
import * as chalk from 'chalk';
import {
  AddAction,
  ConfigureAction,
  CreateAction,
  InfoAction,
  NewAction,
} from '../actions';
import { ApplyAction } from '../actions/apply.action';
import { RefreshAction } from '../actions/refresh.action';
import { ResetAction } from '../actions/reset.action';
import { StartAction } from '../actions/start.action';
import { ERROR_PREFIX } from '../lib/ui';
import { AddCommand } from './add.command';
import { ApplyCommand } from './apply.command';
import { ConfigureCommand } from './configure.command';
import { CreateCommand } from './create.command';
import { InfoCommand } from './info.command';
import { NewCommand } from './new.command';
import { RefreshCommand } from './refresh.command';
import { ResetCommand } from './reset.command';
import { StartCommand } from './start.command';

export class CommandLoader {
  public static async load(program: Command): Promise<void> {
    new NewCommand(new NewAction()).load(program);
    new CreateCommand(new CreateAction()).load(program);
    new AddCommand(new AddAction()).load(program);
    new InfoCommand(new InfoAction()).load(program);
    new StartCommand(new StartAction()).load(program);
    new RefreshCommand(new RefreshAction()).load(program);
    new ResetCommand(new ResetAction()).load(program);
    new ApplyCommand(new ApplyAction()).load(program);
    new ConfigureCommand(new ConfigureAction()).load(program);

    this.handleInvalidCommand(program);
  }

  private static handleInvalidCommand(program: Command) {
    program.on('command:*', () => {
      console.error(
        `\n${ERROR_PREFIX} Invalid command: ${chalk.red('%s')}`,
        program.args.join(' '),
      );
      console.info(
        `See ${chalk.red('--help')} for a list of available commands.\n`,
      );
      process.exit(1);
    });
  }
}
