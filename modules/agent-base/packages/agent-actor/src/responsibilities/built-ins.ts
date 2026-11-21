import { parseResponsibilityId } from './identifiers.js';
import type { ResponsibilityDefinitionInput } from './types/definition.js';

export const FOREGROUND_INTERACTION_RESPONSIBILITY_ID =
  parseResponsibilityId('foreground-interaction');
export const SESSION_COMPACTION_RESPONSIBILITY_ID = parseResponsibilityId('session-compaction');

export const BUILT_IN_RESPONSIBILITIES: readonly ResponsibilityDefinitionInput[] = Object.freeze([
  Object.freeze({
    id: FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
    requiredCapabilities: Object.freeze({
      invocationMode: 'interaction' as const,
      inputMediaTypes: Object.freeze(['text' as const]),
      interaction: Object.freeze({ streamable: true as const }),
      cancellation: true as const,
    }),
  }),
  Object.freeze({
    id: SESSION_COMPACTION_RESPONSIBILITY_ID,
    requiredCapabilities: Object.freeze({
      invocationMode: 'direct' as const,
      inputMediaTypes: Object.freeze(['text' as const]),
      cancellation: true as const,
    }),
  }),
]);
