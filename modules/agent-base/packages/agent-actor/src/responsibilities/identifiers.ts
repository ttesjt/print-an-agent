import { AgentActorError } from '../errors.js';
import type { ResponsibilityId } from './types/definition.js';

export function parseResponsibilityId(value: unknown): ResponsibilityId {
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    !/^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i.test(value)
  ) {
    throw new AgentActorError(
      'RESPONSIBILITY_ID_INVALID',
      'Responsibility ID must be a valid identifier.'
    );
  }
  return value as ResponsibilityId;
}
