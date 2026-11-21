import { defineAssistantModelMessage } from '../messages/index.js';
import type { ModelGenerationEvent } from './types.js';
import {
  invalid,
  requirePlainRecord,
  requireDataProperty,
  assertExactKeys,
  requireString,
} from './validation.js';

export function normalizeGenerationRecord(
  record: Readonly<Record<string, unknown>>,
  type: unknown
): ModelGenerationEvent | undefined {
  if (type === 'text-delta' || type === 'reasoning-delta') {
    assertExactKeys(record, ['delta', 'type']);
    return Object.freeze({
      type,
      delta: requireString(requireDataProperty(record, 'delta'), 'delta'),
    });
  }
  if (type === 'assistant-complete') {
    assertExactKeys(record, ['message', 'type']);
    return Object.freeze({
      type,
      message: defineAssistantModelMessage(requireDataProperty(record, 'message')),
    });
  }
  return undefined;
}

export function defineModelGenerationEvent(input: unknown): ModelGenerationEvent {
  const record = requirePlainRecord(input);
  const event = normalizeGenerationRecord(record, requireDataProperty(record, 'type'));
  if (event !== undefined) return event;
  throw invalid('Generation cannot emit interaction lifecycle or tool execution events.');
}
