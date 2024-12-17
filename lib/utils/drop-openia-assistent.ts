import { AssistantDeleted } from 'openai/resources/beta/assistants';
import { getOpenIAClient } from './get-openia-client';

/**
 * @description Deletes an OpenIA assistant by its ID.
 *
 * @param {string} id - The unique identifier of the assistant to be deleted.
 * @returns {Promise <AssistantDeleted & { _request_id?: string | null }>} - A promise that resolves with the result of the deletion operation.
 */
export const dropOpenIAAssistent = async (
  id: string,
): Promise<
  AssistantDeleted & {
    _request_id?: string | null;
  }
> => {
  const client = await getOpenIAClient();

  const assistant = await client.beta.assistants.del(id);

  return assistant;
};
