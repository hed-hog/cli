import { AssistantCreateParams } from 'openai/resources/beta/assistants';
import { getOpenIAClient } from './get-openia-client';

export const createOpenIAAssistent = async ({
  model = 'gpt-4o-mini',
  description,
  instructions,
  name,
  response_format,
}: AssistantCreateParams) => {
  const client = await getOpenIAClient();

  const assistant = await client.beta.assistants.create({
    model,
    description,
    instructions,
    name,
    response_format,
  });

  return assistant;
};
