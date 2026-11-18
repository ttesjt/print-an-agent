import { AgentSessionError, type SessionCompactionPolicy } from '@print-an-agent/base-session';
import { runWithExecutionTimeout } from '@print-an-agent/workflow-core';
import {
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
  type ResponsibilityRouter,
} from '@print-an-agent/base-actor';
import type { TokenCounter, TextTokenInput } from '@print-an-agent/model-invocation-core';

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

/** One operation boundary owns the deadline for every Step and every generation. */
export async function executeCompactionRun(options: {
  readonly policy: SessionCompactionPolicy;
  readonly signal: AbortSignal;
  readonly execute: (signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  try {
    await runWithExecutionTimeout(
      {
        parentSignal: options.signal,
        timeoutMilliseconds: options.policy.timeoutMilliseconds,
        createTimeoutFailure: ({ timeoutMilliseconds, cause }) =>
          new AgentSessionError(
            'SESSION_COMPACTION_TIMEOUT',
            `Compaction execution exceeded ${timeoutMilliseconds} milliseconds.`,
            { cause }
          ),
      },
      options.execute
    );
  } catch (cause: unknown) {
    // Cancellation state alone cannot establish ownership of an already settled failure.
    if (options.signal.aborted && Object.is(cause, options.signal.reason)) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_CANCELLED',
        'Compaction was cancelled by its parent.',
        { cause }
      );
    }
    throw cause;
  }
}
