import OpenAI from 'openai';
import { getConfig } from './get-config';

export const getOpenIAClient = async () => {
  const apiKey = await getConfig('tokens.OPENIA');

  return new OpenAI({
    apiKey,
  });
};
