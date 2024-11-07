import { readFile } from 'fs/promises';
import path = require('path');
import * as yaml from 'yaml';

export const filterScreenCreation = async (
  libraryPath: string,
  tableName: string,
  task?: any,
) => {
  const hedhogFilePath = path.join(libraryPath, '..', 'hedhog.yaml');
  const hedhogFile = yaml.parse(await readFile(hedhogFilePath, 'utf-8'));
  const taskCondition = !task ? false : task.subPath === 'react-query';

  return (
    (hedhogFile.screens &&
      Object.keys(hedhogFile.screens).includes(tableName)) ||
    taskCondition
  );
};
