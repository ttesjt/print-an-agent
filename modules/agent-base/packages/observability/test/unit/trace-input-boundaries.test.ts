import { describe, expect, it } from 'vitest';
import {
  AgentObservabilityError,
  createAgentTraceEmitter,
  validateAgentTraceEvent,
  validateAgentTraceEventDetails,
  type AgentTraceEvent,
} from '../../src/index.js';

const envelope = {
  schemaVersion: 2,
  agentId: 'agent',
  agentRunId: 'run',
  sequence: 1,
  timestamp: 1,
} as const;

describe('Trace input boundaries', () => {
  it.each([undefined, null, 42, {}, [], '', 'x'.repeat(129)])(
    'rejects invalid emitter identifiers with a configuration error: %j',
    (value) => {
      for (const key of ['agentId', 'agentRunId']) {
        expect(() =>
          Reflect.apply(createAgentTraceEmitter, undefined, [
            { agentId: 'agent', agentRunId: 'run', [key]: value },
          ])
        ).toThrowError(AgentObservabilityError);
      }
    }
  );

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
});
