import { Input } from '../commands';
import { ActionBase } from './action.base';

export abstract class AbstractAction extends ActionBase {
  public abstract handle(
    inputs?: Input[],
    options?: Input[],
    extraFlags?: string[],
  ): Promise<{ packagesAdded: string[] } | void>;
}
