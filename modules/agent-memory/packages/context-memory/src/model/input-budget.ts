import {
  requireTokenMeasurement,
  type TextTokenInput,
  type TokenCounter,
} from '@ta-agent/model-invocation-core';
import type { ModelMemoryRequest } from './input.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';

export async function checkMemoryInputBudget(
  input: ModelMemoryRequest,
  counter: TokenCounter<TextTokenInput>,
  limit: number,
  signal: AbortSignal
): Promise<void> {
  try {
    const measured = requireTokenMeasurement(
      await counter.measure(
        {
          kind: 'text',
          text: JSON.stringify({
            context: input.context,
            ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
          }),
        },
        signal
      ),
      { measurementRef: counter.descriptor.measurementRef, scope: 'text' }
    );
    assertMemoryNotAborted(signal);
    if (measured.accuracy !== 'exact')
      throw new ContextMemoryError(
        'TOKEN_MEASUREMENT_INEXACT',
        'Finite input budgets require exact text measurement.'
      );
    if (measured.tokens > limit)
      throw new ContextMemoryError(
        'BUDGET_EXCEEDED',
        'Experience/instruction input exceeds its explicit budget.',
        {
          details: { actual: measured.tokens, limit, kind: 'input-tokens' },
        }
      );
  } catch (cause) {
    assertMemoryNotAborted(signal);
    if (cause instanceof ContextMemoryError) throw cause;
    throw new ContextMemoryError('TOKENIZER_UNAVAILABLE', 'Memory input measurement failed.', {
      cause,
    });
  }
}
