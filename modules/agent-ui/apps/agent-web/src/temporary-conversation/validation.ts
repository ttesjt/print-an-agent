import { array, object, text, schemas, fail } from '@print-an-agent/ui-transport';
import type { TemporaryConversationRequest } from './contracts.js';

export const TEMPORARY_LIMITS = Object.freeze({
  maxHistoryTurns: 64,
  maxMessageCharacters: 32_000,
  maxHistoryCharacters: 192_000,
  maxOutputCharacters: 64_000,
  maxReasoningCharacters: 64_000,
});
const pair = object({
  user: text(TEMPORARY_LIMITS.maxMessageCharacters, 1),
  assistant: text(TEMPORARY_LIMITS.maxOutputCharacters),
});
const request = object({
  interactionId: schemas.id,
  agentId: schemas.id,
  expectedConfigRevision: schemas.revision,
  message: text(TEMPORARY_LIMITS.maxMessageCharacters, 1),
  history: array(pair, TEMPORARY_LIMITS.maxHistoryTurns),
});

export function parseTemporaryRequest(input: unknown): TemporaryConversationRequest {
  const parsed = request.decode(input);
  if (parsed.message.trim().length === 0) return fail();
  // Reconstruct dense, detached history even for callers using the JS port rather than JSON.
  const history = Array.from(parsed.history, (value) => Object.freeze(pair.decode(value)));
  if (JSON.stringify(history).length > TEMPORARY_LIMITS.maxHistoryCharacters) return fail();
  return Object.freeze({ ...parsed, history: Object.freeze(history) });
}
