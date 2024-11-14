import * as chalk from 'chalk';
import { Command } from '@commander-js/extra-typings';
import {
  AddAction,
  ConfigureAction,
  CreateAction,
  InfoAction,
  NewAction,
} from '../actions';
import { AddCommand } from './add.command';
import { NewCommand } from './new.command';
import { ERROR_PREFIX } from '../lib/ui';
import { InfoCommand } from './info.command';
import { CreateCommand } from './create.command';
import { StartCommand } from './start.command';
import { StartAction } from '../actions/start.action';
import { RefreshCommand } from './refresh.command';
import { RefreshAction } from '../actions/refresh.action';
import { ResetCommand } from './reset.command';
import { ResetAction } from '../actions/reset.action';
import { ApplyCommand } from './apply.command';
import { ApplyAction } from '../actions/apply.action';
import { ConfigureCommand } from './configure.command';
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
