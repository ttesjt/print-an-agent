import type { ModelInteractionEvent } from './types.js';
import { normalizeGenerationRecord } from './generation.js';
import {
  invalid,
  requirePlainRecord,
  requireDataProperty,
  assertExactKeys,
  requireString,
  requireCount,
} from './validation.js';

export function defineModelInteractionEvent(input: unknown): ModelInteractionEvent {
  const record = requirePlainRecord(input);
  const type = requireDataProperty(record, 'type');
  if (
    type === 'interaction-start' ||
    type === 'turn-start' ||
    type === 'turn-end' ||
    type === 'interaction-end'
  ) {
    assertExactKeys(record, ['type']);
    return Object.freeze({ type });
  }
  const generation = normalizeGenerationRecord(record, type);
  if (generation !== undefined) return generation;
  if (type === 'tool-call-start') {
    assertExactKeys(record, ['callId', 'toolName', 'type']);
    return Object.freeze({
      type,
      callId: requireString(requireDataProperty(record, 'callId'), 'callId'),
      toolName: requireString(requireDataProperty(record, 'toolName'), 'toolName'),
    });
  }
  if (type === 'tool-call-end') {
    assertExactKeys(record, ['callId', 'resultCharacters', 'status', 'toolName', 'type']);
    const status = requireDataProperty(record, 'status');
    if (status !== 'success' && status !== 'error') {
      throw invalid('Model interaction event Tool status is unsupported.');
    }
    return Object.freeze({
      type,
      callId: requireString(requireDataProperty(record, 'callId'), 'callId'),
      toolName: requireString(requireDataProperty(record, 'toolName'), 'toolName'),
      status,
      resultCharacters: requireCount(
        requireDataProperty(record, 'resultCharacters'),
        'resultCharacters'
      ),
    });
  }
  throw invalid('Model interaction event type is unsupported.');
}
