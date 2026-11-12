import {
  bindTextTokenCounter,
  requireTokenMeasurement,
  type TextTokenInput,
  type TokenCounter,
  type TokenMeasurement,
} from '@print-an-agent/model-invocation-core';
import type { ResolvedContextInput, RetrievalContextOptions } from '../contracts/context.js';
import type { RetrievalHit } from '../contracts/data.js';
import { assertNotAborted, fail, RetrievalMemoryError } from '../errors.js';
import { text } from '../validation/json.js';
import { DEFAULT_RETRIEVAL_RENDERER } from './renderer.js';
export function createContextMeter(options: RetrievalContextOptions) {
  const counter: TokenCounter<TextTokenInput> | undefined =
    options.counter === undefined ? undefined : bindTextTokenCounter(options.counter);
  return {
    requireCounter(maxTokens: number | null): void {
      if (maxTokens !== null && counter === undefined)
        fail(
          'TOKEN_COUNTER_REQUIRED',
          'A finite context budget requires an exact text TokenCounter.'
        );
    },
    async render(
      input: ResolvedContextInput,
      hits: readonly RetrievalHit[],
      signal: AbortSignal
    ): Promise<{ text: string; measurement: TokenMeasurement | null }> {
      assertNotAborted(signal);
      const renderer =
        options.renderers === undefined
          ? DEFAULT_RETRIEVAL_RENDERER
          : await options.renderers.resolve(input.rendererRef, signal);
      if (renderer.ref !== input.rendererRef)
        fail('CONFIG_INVALID', 'Requested context renderer is not available.');
      const output = await renderer.render({ hits, separator: input.separator }, signal);
      let rendered: string;
      try {
        rendered = text(output);
      } catch (cause) {
        throw new RetrievalMemoryError(
          'REPRESENTATION_INVALID',
          'Renderer did not return valid Unicode text.',
          { cause }
        );
      }
      assertNotAborted(signal);
      if (input.maxTokens === null) return { text: rendered, measurement: null };
      if (counter === undefined)
        return fail('TOKEN_COUNTER_REQUIRED', 'Finite budget requires a TokenCounter.');
      try {
        const measurement = requireTokenMeasurement(
          await counter.measure({ kind: 'text', text: rendered }, signal),
          {
            measurementRef: counter.descriptor.measurementRef,
            inputProtocolRef: counter.descriptor.inputProtocolRef,
            scope: 'text',
            accuracy: 'exact',
          }
        );
        assertNotAborted(signal);
        return { text: rendered, measurement };
      } catch (cause) {
        assertNotAborted(signal);
        throw new RetrievalMemoryError('MEASUREMENT_FAILED', 'Exact context measurement failed.', {
          cause,
        });
      }
    },
  };
}
