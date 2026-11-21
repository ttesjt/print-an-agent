import { describe, expect, it } from 'vitest';
import {
  AgentObservabilityError,
  createAgentTraceEmitter,
  validateAgentTraceEvent,
  validateAgentTraceEventDetails,
  type AgentTraceEvent,
} from '../../../src/index.js';

const envelope = {
  schemaVersion: 2,
  agentId: 'agent',
  agentRunId: 'run',
  sequence: 1,
  timestamp: 1,
} as const;

describe('Trace metadata boundaries', () => {
  describe.each([
    {
      name: 'event details',
      validate: (value: unknown) => validateAgentTraceEventDetails(value),
      fields: { type: 'agent-run-started', operationName: 'test' },
    },
    {
      name: 'persisted event',
      validate: (value: unknown) => validateAgentTraceEvent(value),
      fields: { ...envelope, type: 'agent-run-started', operationName: 'test' },
    },
  ])('$name assertion boundary', ({ validate, fields }) => {
    it('rejects Proxy inputs without executing caller traps', () => {
      let trapCalls = 0;
      const value = new Proxy(fields, {
        get(target, key, receiver): unknown {
          trapCalls += 1;
          return key === 'operationName' ? undefined : Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          trapCalls += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          trapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      expect(() => validate(value)).toThrowError(AgentObservabilityError);
      expect(trapCalls).toBe(0);
    });

    it('rejects transparent Proxy inputs', () => {
      expect(() => validate(new Proxy(fields, {}))).toThrowError(AgentObservabilityError);
    });

    it('rejects revoked Proxy inputs with a trace validation error', () => {
      const { proxy, revoke } = Proxy.revocable(fields, {});
      revoke();
      expect(() => validate(proxy)).toThrowError(AgentObservabilityError);
    });
  });

  it.each(['symbol', 'hidden', 'accessor'] as const)(
    'rejects %s properties at emission and persisted-event validation boundaries',
    async (kind) => {
      const events: AgentTraceEvent[] = [];
      const trace = createAgentTraceEmitter({
        agentId: 'agent',
        agentRunId: 'run',
        clock: () => 1,
        sink: {
          record: (event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
      });
      let getterReads = 0;
      const details = { type: 'agent-run-started', operationName: 'test' };
      if (kind === 'symbol') {
        Object.defineProperty(details, Symbol('extra'), { enumerable: true, value: 'private' });
      } else if (kind === 'hidden') {
        Object.defineProperty(details, 'extra', { value: 'private' });
      } else {
        Object.defineProperty(details, 'operationName', {
          enumerable: true,
          get: () => (++getterReads === 1 ? 'test' : ''),
        });
      }

      expect(() => validateAgentTraceEventDetails(details)).toThrowError(AgentObservabilityError);
      // Preserve property descriptors instead of evaluating the accessor with a spread.
      const persisted = Object.defineProperties(
        { ...envelope },
        Object.getOwnPropertyDescriptors(details)
      );
      expect(() => validateAgentTraceEvent(persisted)).toThrowError(AgentObservabilityError);
      await expect(
        Reflect.apply(trace.record.bind(trace), undefined, [details])
      ).rejects.toMatchObject({
        code: 'TRACE_EVENT_INVALID',
      });
      expect(events).toEqual([]);
      expect(getterReads).toBe(0);
      await trace.record({ type: 'agent-run-started', operationName: 'valid' });
      expect(events[0]?.sequence).toBe(1);
    }
  );

  it('captures metadata before an injected clock or caller can mutate the input', async () => {
    const events: AgentTraceEvent[] = [];
    const details = { type: 'agent-run-started' as const, operationName: 'original' };
    const mutable = { ...details };
    let clockCalls = 0;
    const trace = createAgentTraceEmitter({
      agentId: 'agent',
      agentRunId: 'run',
      clock: () => {
        clockCalls += 1;
        if (clockCalls > 1) mutable.operationName = '';
        return clockCalls;
      },
      sink: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
    });
    await trace.record({ type: 'agent-run-started', operationName: 'first' });
    const pending = trace.record(mutable);
    Object.assign(mutable, { operationName: 'changed', extra: 'private' });
    await pending;

    expect(events[1]).toMatchObject({ operationName: 'original', sequence: 2, timestamp: 2 });
    expect(events[1]).not.toHaveProperty('extra');
    expect(events.every(Object.isFrozen)).toBe(true);
    for (const event of events) expect(() => validateAgentTraceEvent(event)).not.toThrow();
  });

  it('delivers the validated snapshot when emission receives a Proxy', async () => {
    const events: AgentTraceEvent[] = [];
    const trace = createAgentTraceEmitter({
      agentId: 'agent',
      agentRunId: 'run',
      clock: () => 1,
      sink: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
    });
    let reads = 0;
    const details = new Proxy(
      { type: 'agent-run-started' as const, operationName: 'snapshot value' },
      {
        get(): undefined {
          reads += 1;
          return undefined;
        },
      }
    );

    await trace.record(details);
    expect(events[0]).toMatchObject({ operationName: 'snapshot value', sequence: 1 });
    expect(reads).toBe(0);
    expect(() => validateAgentTraceEvent(events[0])).not.toThrow();
  });

  it('rejects unknown event fields before they reach a sink', async () => {
    const events: AgentTraceEvent[] = [];
    const trace = createAgentTraceEmitter({
      agentId: 'assistant',
      agentRunId: 'request-1',
      sink: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
      clock: () => 1,
    });
    const record = trace.record.bind(trace);

    await expect(
      Reflect.apply(record, undefined, [
        { type: 'agent-run-started', operationName: 'test', privateMessage: 'must not persist' },
      ])
    ).rejects.toMatchObject({ code: 'TRACE_EVENT_INVALID' });
    expect(events).toEqual([]);
  });
});
