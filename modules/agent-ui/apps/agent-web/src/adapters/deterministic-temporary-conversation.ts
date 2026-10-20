import {
  TEMPORARY_EVENT as E,
  type TemporaryConversationPort,
} from '../temporary-conversation/contracts.js';
import { parseTemporaryRequest } from '../temporary-conversation/validation.js';

/** Explicit browser-only fixture; never selected as a live provider fallback. */
export function createDeterministicTemporaryConversation(): TemporaryConversationPort {
  return {
    async streamTemporaryConversation(request, consume) {
      const { signal, ...payload } = request;
      const input = parseTemporaryRequest(payload);
      signal?.throwIfAborted();
      await consume({ type: E.OPENED, interactionId: input.interactionId });
      const reasoning = 'This is a deterministic temporary-conversation demonstration.';
      const text = `Temporary reply (${input.history.length + 1}): ${input.message}`;
      for (const event of [
        { type: E.REASONING, delta: reasoning },
        { type: E.TEXT, delta: text },
      ]) {
        signal?.throwIfAborted();
        await consume({ ...event, interactionId: input.interactionId });
      }
      signal?.throwIfAborted();
      await consume({
        type: E.COMPLETED,
        interactionId: input.interactionId,
        configRevision: input.expectedConfigRevision,
        assistant: {
          text,
          timestamp: new Date().toISOString(),
          stopReason: 'stop',
          reasoningBlocks: [{ modelTurnIndex: 1, text: reasoning }],
        },
      });
    },
  };
}
