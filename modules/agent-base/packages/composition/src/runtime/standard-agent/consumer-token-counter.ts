import {
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
  type ResponsibilityRouter,
} from '@print-an-agent/base-actor';
import { AgentSessionError } from '@print-an-agent/base-session';
import type { TextTokenInput, TokenCounter } from '@print-an-agent/model-invocation-core';

export async function resolveConsumerTokenCounter(
  router: ResponsibilityRouter,
  signal: AbortSignal
): Promise<TokenCounter<TextTokenInput>> {
  signal.throwIfAborted();
  try {
    const consumer = await router.resolve(FOREGROUND_INTERACTION_RESPONSIBILITY_ID);
    signal.throwIfAborted();
    if (consumer.actor.textTokenCounter === undefined)
      throw new AgentSessionError(
        'SESSION_COMPACTION_TOKENIZER_NOT_CONFIGURED',
        'The consuming Actor has no text token counter.'
      );
    return consumer.actor.textTokenCounter;
  } catch (cause: unknown) {
    signal.throwIfAborted();
    if (cause instanceof AgentSessionError) throw cause;
    throw new AgentSessionError(
      'SESSION_COMPACTION_TOKENIZER_NOT_CONFIGURED',
      'The foreground consumer measurement binding is unavailable.',
      { cause }
    );
  }
}
