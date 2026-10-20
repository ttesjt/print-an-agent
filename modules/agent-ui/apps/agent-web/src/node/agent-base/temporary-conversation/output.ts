import { AgentRequestError, type SessionlessOutputSink } from '@ta-agent/base-request';
import type { ActorDirectResult } from '@ta-agent/model-invocation-core';
import {
  TEMPORARY_EVENT,
  type TemporaryAssistant,
  type TemporaryEventConsumer,
} from '../../../temporary-conversation/contracts.js';

/** Run-local provisional output. Only the enclosing port publishes a wire terminal. */
export function createTemporaryOutput(interactionId: string, consume: TemporaryEventConsumer) {
  const text: string[] = [];
  const reasoning: string[] = [];
  let closed: ActorDirectResult | undefined;
  const sink: SessionlessOutputSink = {
    open: () => Promise.resolve(),
    write: async (event) => {
      (event.type === TEMPORARY_EVENT.TEXT ? text : reasoning).push(event.delta);
      await consume({ ...event, interactionId });
    },
    close: (result) => {
      closed = result;
      return Promise.resolve();
    },
    fail: () => Promise.resolve(),
  };
  return {
    sink,
    complete(result: ActorDirectResult): TemporaryAssistant {
      if (
        closed === undefined ||
        closed.message.text !== result.message.text ||
        (text.length > 0 && text.join('') !== result.message.text)
      ) {
        throw new AgentRequestError(
          'REQUEST_OUTPUT_STATE_INVALID',
          'Temporary output did not complete consistently.'
        );
      }
      const reasoningText = reasoning.join('');
      return Object.freeze({
        text: result.message.text,
        timestamp: new Date(result.message.timestamp).toISOString(),
        stopReason: result.message.stopReason,
        reasoningBlocks: Object.freeze(
          reasoningText.length === 0
            ? []
            : [Object.freeze({ modelTurnIndex: 1, text: reasoningText })]
        ),
      });
    },
  };
}
