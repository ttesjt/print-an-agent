import { parseActorId } from '@print-an-agent/model-invocation-core';
import { AgentActorError } from './errors.js';

declare const responsibilityIdBrand: unique symbol;
export type ResponsibilityId = string & { readonly [responsibilityIdBrand]: 'ResponsibilityId' };

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
export const MAIN_ACTOR_ID = parseActorId('main');
export const FOREGROUND_INTERACTION_RESPONSIBILITY_ID =
  parseResponsibilityId('foreground-interaction');
export const SESSION_COMPACTION_RESPONSIBILITY_ID = parseResponsibilityId('session-compaction');
