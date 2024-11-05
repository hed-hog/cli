import { getOpenIAClient } from './get-openia-client';

export const dropOpenIAAssistent = async (id: string) => {
  const client = await getOpenIAClient();

  const assistant = await client.beta.assistants.del(id);

  return assistant;
};
