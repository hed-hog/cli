import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class RefreshCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('refresh')
      .alias('r')
      .argument('<string>', 'Dependency name to be added.')
      .description(
        'Removes old HedHog dependencies, updates app.module.ts, deletes package-lock.json, and adds a new dependency.',
      )
      .usage('<dependency> [options]')
      .action(async (dependency, command) => {
        const options: Input[] = [];
        const inputs: Input[] = [];

        inputs.push({ name: 'name', value: dependency });
        this.action.handle(inputs, options);
      });
  }
}
