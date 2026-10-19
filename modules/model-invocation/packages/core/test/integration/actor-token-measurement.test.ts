import { expect, it, vi } from 'vitest';
import {
  bindTextTokenCounter,
  createActor,
  createTokenCounter,
  defineActorEngine,
  requireActorTextTokenCounter,
  requireCompletionCapability,
  type ActorEngineInput,
} from '../../src/index.js';
import { assistantMessage } from '../support/fixtures.js';
import {
  textCounterDefinition,
  textInput,
  measurementSignal,
} from '../support/token-measurement.js';

function engine(): ActorEngineInput {
  return {
    id: 'engine',
    capabilities: {
      invocationModes: ['direct'],
      inputMediaTypes: ['text'],
      cancellation: true,
      toolCalling: false,
      structuredOutput: false,
    },
    complete: () => Promise.resolve({ message: assistantMessage('done') }),
  };
}

it('invokes without measurement and reports missing capability only when explicitly requested', async () => {
  const actor = requireCompletionCapability(createActor({ id: 'actor', engine: engine() }));
  expect(actor.textTokenCounter).toBeUndefined();
  expect(() => requireActorTextTokenCounter(actor)).toThrowError(
    'Actor has no text token counter bound.'
  );
  await expect(
    actor.complete({
      instructions: '',
      messages: [],
      maxOutputCharacters: 100,
      signal: measurementSignal(),
    })
  ).resolves.toMatchObject({ message: { text: 'done' } });
});

it('inherits Engine measurement and allows an explicit Actor override without calling the model', async () => {
  const complete = vi.fn(engine().complete);
  const inherited = createTokenCounter(textCounterDefinition());
  const override = createTokenCounter({
    ...textCounterDefinition(),
    measurementRef: 'test:override',
  });
  const base = { ...engine(), complete, textTokenCounter: inherited };
  const a = createActor({ id: 'a', engine: base });
  const b = createActor({ id: 'b', engine: base, textTokenCounter: override });
  expect(requireActorTextTokenCounter(a).descriptor.measurementRef).toBe(
    inherited.descriptor.measurementRef
  );
  const result = await requireActorTextTokenCounter(b).measure(
    textInput('hello'),
    measurementSignal()
  );
  expect(result).toMatchObject({ tokens: 5, measurementRef: 'test:override' });
  expect(complete).not.toHaveBeenCalled();
});

it('rejects a request-scoped counter rather than misrepresenting it as standalone text', () => {
  const counter = createTokenCounter(textCounterDefinition());
  const invalid = { ...counter, descriptor: { ...counter.descriptor, scope: 'request' } };
  const options = { ...engine(), textTokenCounter: invalid };
  expect((): unknown => Reflect.apply(defineActorEngine, undefined, [options])).toThrowError(
    'Binding requires the standard standalone-text protocol and scope.'
  );
});

it('retains receiver, freezes descriptor and rejects metadata spoofing on every measurement', async () => {
  const reference = createTokenCounter(textCounterDefinition());
  let measurementRef = reference.descriptor.measurementRef;
  const borrowed = {
    descriptor: { ...reference.descriptor },
    prefix: 'test',
    async measure() {
      expect(this.prefix).toBe('test');
      return { ...(await reference.measure(textInput('x'), measurementSignal())), measurementRef };
    },
  };
  const bound = bindTextTokenCounter(borrowed);
  borrowed.descriptor.measurementRef = 'test:mutated';
  expect((await bound.measure(textInput('x'), measurementSignal())).tokens).toBe(1);
  expect(Object.isFrozen(bound.descriptor)).toBe(true);
  measurementRef = 'test:spoofed';
  await expect(bound.measure(textInput('x'), measurementSignal())).rejects.toMatchObject({
    code: 'TOKEN_MEASUREMENT_REQUIREMENT_UNSATISFIED',
  });
});

it('preserves parent cancellation in a borrowed asynchronous counter', async () => {
  const controller = new AbortController();
  const reason = new Error('stop');
  const counter = createTokenCounter({
    ...textCounterDefinition(),
    measure: () => {
      controller.abort(reason);
      return Promise.resolve({ tokens: 1, accuracy: 'exact' });
    },
  });
  const actor = createActor({ id: 'a', engine: { ...engine(), textTokenCounter: counter } });
  await expect(
    requireActorTextTokenCounter(actor).measure(textInput('x'), controller.signal)
  ).rejects.toBe(reason);
});
