import { AgentRequestError } from '../errors.js';

export function validateRequestMessage(value: unknown, maxCharacters: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxCharacters) {
    throw new AgentRequestError(
      'REQUEST_INPUT_INVALID',
      `Request message must contain 1-${maxCharacters} characters.`
    );
  }
  return value;
}
