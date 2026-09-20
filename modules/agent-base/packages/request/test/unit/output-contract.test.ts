import type { ReasoningDeltaEvent } from '@ta-agent/base-model';
import { expectTypeOf, it } from 'vitest';
import type {
  OutputReasoningDeltaEvent,
  OutputSink,
  OutputStreamEvent,
  OutputTextDeltaEvent,
} from '../../src/index.js';

it('requires output writers to accept the full event union while sharing the named event contract', () => {
  expectTypeOf<OutputReasoningDeltaEvent>().toEqualTypeOf<ReasoningDeltaEvent>();
  expectTypeOf<OutputSink['write']>().toEqualTypeOf<(event: OutputStreamEvent) => Promise<void>>();
  expectTypeOf<(event: OutputTextDeltaEvent) => Promise<void>>().not.toMatchTypeOf<
    OutputSink['write']
  >();
});
