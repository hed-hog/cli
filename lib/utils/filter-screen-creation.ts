import { loadHedhogFile } from './load-hedhog-file';
import path = require('node:path');

/**
 * Checks if a screen should be created based on the presence of the table name
 * in the `screens` object in the `hedhog.yaml` file and the task condition
 * provided as an argument. If the task condition is not provided, it is
 * considered to be false.
 * @param libraryPath the path to the library directory
 * @param tableName the name of the table to check
 * @param task the task object to check the condition from
 * @returns true if the screen should be created, false otherwise
 */
export const filterScreenCreation = async (
  libraryPath: string,
  tableName: string,
  task?: any,
): Promise<boolean> => {
  const hedhogFilePath = path.join(libraryPath, '..', 'hedhog.yaml');
  const hedhogFile = await loadHedhogFile(hedhogFilePath);
  const taskCondition = !task ? false : task.subPath === 'react-query';
  return (
    (hedhogFile.screens &&
      Object.keys(hedhogFile.screens).includes(tableName)) ||
    taskCondition
  );
};
