/**
 * Generates an input question for inquirer.js
 * @param {string} name The name of the input field
 * @param {string} message The message to display to the user
 * @returns {Function} A function that takes a default answer and returns the input question
 */
export const generateInput = (name: string, message: string): any => {
  return (defaultAnswer: string): any => ({
    type: 'input',
    name,
    message,
    default: defaultAnswer,
  });
};

/**
 * Generates a function that creates a selection prompt configuration object.
 *
 * @param name - The name of the selection prompt.
 * @returns A function that takes a message string and returns another function.
 *          This returned function takes an array of choices and returns an object
 *          representing the selection prompt configuration.
 *
 * @example
 * const selectPrompt = generateSelect('example');
 * const promptConfig = selectPrompt('Choose an option')(['Option 1', 'Option 2']);
 * // promptConfig will be:
 * // {
 * //   type: 'list',
 * //   name: 'example',
 * //   message: 'Choose an option',
 * //   choices: ['Option 1', 'Option 2']
 * // }
 */
export const generateSelect = (
  name: string,
): ((message: string) => (choices: string[]) => any) => {
  return (message: string) => {
    return (choices: string[]) => ({
      type: 'list',
      name,
      message,
      choices,
    });
  };
};
