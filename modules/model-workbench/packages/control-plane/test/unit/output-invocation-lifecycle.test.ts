import type { JsonValue } from '@print-an-agent/workbench-domain';
import {
  OutputInvocationKind,
  type TypedOutputInvokerCapability,
} from '@print-an-agent/workbench-extension';
import { describe, expect, it, vi } from 'vitest';
import { OutputInvocationCapabilityError } from '../../src/index.js';
import {
  createInvocationFixture,
  invokeOutput,
  prepareOutput,
} from '../support/output-invocation-fixture.js';

describe('Output invocation multi-layer lifecycle', () => {
  it.each(['before-next', 'partial', 'exhausted', 'invalid-chunk', 'backend-failure'] as const)(
    'propagates %s through control plane and extension wrappers',
    async (ending) => {
      const failure = new Error('backend failed');
      let count = 0;
      const next = vi.fn((): Promise<IteratorResult<JsonValue>> => {
        if (ending === 'backend-failure') return Promise.reject(failure);
        if (count++ > 0) return Promise.resolve({ done: true, value: undefined });
        return Promise.resolve({
          done: false,
          value: ending === 'invalid-chunk' ? (undefined as never) : 'one',
        });
      });
      const returned = vi.fn(() => Promise.resolve({ done: true as const, value: undefined }));
      const invoke = vi.fn<TypedOutputInvokerCapability<JsonValue, JsonValue>>(() =>
        Promise.resolve({
          kind: OutputInvocationKind.Streaming,
          stream: { [Symbol.asyncIterator]: () => ({ next, return: returned }) },
        })
      );
      const fixture = createInvocationFixture({ invoke });
      await prepareOutput(fixture.workbench);
      const invocation = await invokeOutput(fixture.workbench);
      if (invocation.kind !== OutputInvocationKind.Streaming)
        throw new Error('Expected streaming.');
      expect(invoke).toHaveBeenCalledOnce();
      const iterator = invocation.stream[Symbol.asyncIterator]();
      expect(next).not.toHaveBeenCalled();
      if (ending === 'invalid-chunk' || ending === 'backend-failure')
        await expect(iterator.next()).rejects.toBeInstanceOf(OutputInvocationCapabilityError);
      else if (ending !== 'before-next')
        await expect(iterator.next()).resolves.toEqual({ done: false, value: 'one' });
      if (ending === 'exhausted')
        await expect(iterator.next()).resolves.toMatchObject({ done: true });
      await Promise.all([iterator.return?.(), iterator.return?.()]);
      expect(returned).toHaveBeenCalledTimes(ending === 'exhausted' ? 0 : 1);
      const expectedPulls = ending === 'before-next' ? 0 : ending === 'exhausted' ? 2 : 1;
      expect(next).toHaveBeenCalledTimes(expectedPulls);
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
      expect(next).toHaveBeenCalledTimes(expectedPulls);
    }
  );

  it.each(['ordinary', 'abort'] as const)(
    'classifies %s return failure without repeating cleanup',
    async (kind) => {
      const failure = new Error('return failed');
      if (kind === 'abort') failure.name = 'AbortError';
      const next = vi.fn();
      const returned = vi.fn(() => Promise.reject(failure));
      const fixture = createInvocationFixture({
        invoke: () =>
          Promise.resolve({
            kind: OutputInvocationKind.Streaming,
            stream: { [Symbol.asyncIterator]: () => ({ next, return: returned }) },
          }),
      });
      await prepareOutput(fixture.workbench);
      const invocation = await invokeOutput(fixture.workbench);
      if (invocation.kind !== OutputInvocationKind.Streaming)
        throw new Error('Expected streaming.');
      const iterator = invocation.stream[Symbol.asyncIterator]();
      for (let repeat = 0; repeat < 2; repeat++) {
        if (kind === 'abort') await expect(iterator.return?.()).rejects.toBe(failure);
        else
          await expect(iterator.return?.()).rejects.toMatchObject({
            name: OutputInvocationCapabilityError.name,
            cause: failure,
          });
      }
      expect(returned).toHaveBeenCalledOnce();
      expect(next).not.toHaveBeenCalled();
    }
  );
});
