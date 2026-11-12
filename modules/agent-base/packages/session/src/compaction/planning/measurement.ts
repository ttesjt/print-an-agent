import {
  bindTextTokenCounter,
  requireTokenMeasurement,
  TOKEN_MEASUREMENT_ACCURACY,
  type TextTokenInput,
  type TokenCounter,
} from '@print-an-agent/model-invocation-core';
import { AgentSessionError } from '../../errors.js';

export function bindSessionCompactionTokenCounter(
  input: TokenCounter<TextTokenInput>
): TokenCounter<TextTokenInput> {
  try {
    return bindTextTokenCounter(input);
  } catch (cause: unknown) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_TOKENIZER_FAILED',
      'Compaction requires a valid standalone-text counter.',
      { cause }
    );
  }
}

export interface CompactionMeasurementResources {
  readonly tokenCounter?: TokenCounter<TextTokenInput>;
  readonly resolveTokenCounter?: (signal: AbortSignal) => Promise<TokenCounter<TextTokenInput>>;
}

/** Resolve from explicit host binding or the consuming model, never the summarizing model. */
export async function resolveSessionCompactionCounter(
  resources: CompactionMeasurementResources,
  signal: AbortSignal
): Promise<TokenCounter<TextTokenInput>> {
  signal.throwIfAborted();
  if (resources.tokenCounter === undefined && resources.resolveTokenCounter === undefined)
    throw new AgentSessionError(
      'SESSION_COMPACTION_TOKENIZER_NOT_CONFIGURED',
      'No compaction text counter is bound.'
    );
  if (resources.tokenCounter !== undefined && resources.resolveTokenCounter !== undefined)
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Compaction measurement binding is ambiguous.'
    );
  try {
    const counter = resources.tokenCounter ?? (await resources.resolveTokenCounter?.(signal));
    signal.throwIfAborted();
    if (counter === undefined)
      throw new AgentSessionError(
        'SESSION_COMPACTION_TOKENIZER_NOT_CONFIGURED',
        'No compaction text counter is available.'
      );
    return bindSessionCompactionTokenCounter(counter);
  } catch (cause: unknown) {
    signal.throwIfAborted();
    if (cause instanceof AgentSessionError) throw cause;
    throw new AgentSessionError(
      'SESSION_COMPACTION_TOKENIZER_FAILED',
      'Compaction counter resolution failed.',
      { cause }
    );
  }
}

export async function measureSessionCompactionText(
  text: string,
  counter: TokenCounter<TextTokenInput>,
  signal: AbortSignal
): Promise<number> {
  signal.throwIfAborted();
  try {
    const bound = bindTextTokenCounter(counter);
    const result = requireTokenMeasurement(await bound.measure({ kind: 'text', text }, signal), {
      measurementRef: bound.descriptor.measurementRef,
      inputProtocolRef: bound.descriptor.inputProtocolRef,
      scope: bound.descriptor.scope,
    });
    signal.throwIfAborted();
    if (result.accuracy !== TOKEN_MEASUREMENT_ACCURACY.EXACT)
      throw new AgentSessionError(
        'SESSION_COMPACTION_MEASUREMENT_INEXACT',
        'Compaction acceptance requires exact text measurement.'
      );
    return result.tokens;
  } catch (cause: unknown) {
    signal.throwIfAborted();
    if (cause instanceof AgentSessionError) throw cause;
    throw new AgentSessionError(
      'SESSION_COMPACTION_TOKENIZER_FAILED',
      'Compaction token measurement failed.',
      { cause }
    );
  }
}
