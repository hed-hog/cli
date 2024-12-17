import { Input } from '../commands';
import { ActionBase } from './action.base';

/**
 * Abstract base class for actions that handle inputs, options, and extra flags.
 * @abstract
 */
export abstract class AbstractAction extends ActionBase {
  /**
   * Handles the action with the specified inputs, options, and extra flags.
   *
   * @param {Input[]} [inputs] - An optional array of inputs for the action.
   * @param {Input[]} [options] - An optional array of options for the action.
   * @param {string[]} [extraFlags] - An optional array of extra flags to modify the behavior of the action.
   * @returns {Promise<{ packagesAdded: string[] } | void>} A promise that resolves with an object containing the packages added or void.
   */
  public abstract handle(
    inputs?: Input[],
    options?: Input[],
    extraFlags?: string[],
  ): Promise<{ packagesAdded: string[] } | void>;
}
