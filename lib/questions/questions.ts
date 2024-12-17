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
