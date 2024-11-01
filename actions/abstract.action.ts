import { Input } from '../commands';
import { debug } from '../lib/utils/debug';

export abstract class AbstractAction {
  protected debug = false;

  public abstract handle(
    inputs?: Input[],
    options?: Input[],
    extraFlags?: string[],
  ): Promise<{ packagesAdded: string[] } | void>;

  showDebug(...args: any[]) {
    if (this.debug) {
      debug(...args);
    }
  }
}
