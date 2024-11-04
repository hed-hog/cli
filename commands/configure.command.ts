import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class ConfigureCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('configure')
      .option('--debug', 'Show debug information.', false)
      .option('--openia-token <openiaToken>', 'OpenIA token.', '')
      .description('Configures the hedhog CLI.')
      .usage('[options]')
      .action(async (opts: Record<string, any>, _command: Command) => {
        const options: Input[] = [];

        options.push({ name: 'debug', value: Boolean(opts.debug) });

        options.push({ name: 'openiaToken', value: opts?.openiaToken ?? '' });

        const inputs: Input[] = [];

        this.action.handle(inputs, options);
      });
  }
}
