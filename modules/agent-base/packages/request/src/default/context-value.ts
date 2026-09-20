import { AgentRequestError } from '../errors.js';

export function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new AgentRequestError(
      'REQUEST_CONTEXT_INCOMPLETE',
      `Request context is missing required value "${name}".`
    );
  }
  return value;
}
