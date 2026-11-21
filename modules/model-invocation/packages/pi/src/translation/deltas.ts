import type { AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { TextDeltaEvent, ReasoningDeltaEvent } from '@print-an-agent/model-invocation-core';

/** Publish readable data only; provider signatures, redaction and end snapshots stay private. */
export function readablePiDelta(
  event: AssistantMessageEvent
): TextDeltaEvent | ReasoningDeltaEvent | undefined {
  if (event.type === 'text_delta' && event.delta.length > 0) {
    return Object.freeze({ type: 'text-delta', delta: event.delta });
  }
  if (event.type !== 'thinking_delta' || event.delta.length === 0) return undefined;
  const block = event.partial.content[event.contentIndex];
  if (block?.type !== 'thinking' || block.redacted === true) return undefined;
  return Object.freeze({ type: 'reasoning-delta', delta: event.delta });
}
