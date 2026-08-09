import { describe, expect, it } from 'vitest';
import {
  AgentObservabilityError,
  createAgentTraceEmitter,
  type AgentTraceEvent,
  type AgentTraceEventSink,
  type AgentTraceSinkFailure,
} from '../../src/index.js';

describe('Agent trace emitter', () => {
  it('adds deterministic immutable correlation envelopes and per-run sequences', async () => {
    const events: AgentTraceEvent[] = [];
    const sink: AgentTraceEventSink = {
      record: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
    let timestamp = 9;
    const trace = createAgentTraceEmitter({
      agentId: 'assistant',
      agentRunId: 'request-1',
      sink,
      clock: () => (timestamp += 1),
    });

    await trace.record({ type: 'agent-run-started', operationName: 'test' });
    await trace.record({ type: 'agent-run-completed', operationName: 'test' });

    expect(events).toEqual([
      {
        schemaVersion: 1,
        agentId: 'assistant',
        agentRunId: 'request-1',
        sequence: 1,
        timestamp: 10,
        type: 'agent-run-started',
        operationName: 'test',
      },
      {
        schemaVersion: 1,
        agentId: 'assistant',
        agentRunId: 'request-1',
        sequence: 2,
        timestamp: 11,
        type: 'agent-run-completed',
        operationName: 'test',
      },
    ]);
    expect(events.every(Object.isFrozen)).toBe(true);
  });

  it('serializes concurrent writes without sharing sequence state between runs', async () => {
    const calls: string[] = [];
    const sink: AgentTraceEventSink = {
      record: async (event) => {
        calls.push(`start:${event.agentRunId}:${event.sequence}`);
        await Promise.resolve();
        calls.push(`end:${event.agentRunId}:${event.sequence}`);
      },
    };
    const first = createAgentTraceEmitter({
      agentId: 'assistant',
      agentRunId: 'first',
      sink,
      clock: () => 1,
    });
    const second = createAgentTraceEmitter({
      agentId: 'assistant',
      agentRunId: 'second',
      sink,
      clock: () => 1,
    });

    await Promise.all([
      first.record({ type: 'agent-run-started', operationName: 'test' }),
      first.record({ type: 'agent-run-completed', operationName: 'test' }),
      second.record({ type: 'agent-run-started', operationName: 'test' }),
    ]);

    expect(calls.indexOf('end:first:1')).toBeLessThan(calls.indexOf('start:first:2'));
    expect(calls).toContain('start:second:1');
  });

  it('isolates sink and failure-reporter failures from execution', async () => {
    const sinkFailure = new Error('sink unavailable');
    const failures: AgentTraceSinkFailure[] = [];
    const trace = createAgentTraceEmitter({
      agentId: 'assistant',
      agentRunId: 'request-1',
      sink: { record: () => Promise.reject(sinkFailure) },
      onSinkFailure: (failure) => {
        failures.push(failure);
        return Promise.reject(new Error('reporter unavailable'));
      },
      clock: () => 1,
    });

    await expect(
      trace.record({ type: 'agent-run-started', operationName: 'test' })
    ).resolves.toBeUndefined();
    expect(failures).toHaveLength(1);
    const failure = failures[0];
    expect(failure?.cause).toBe(sinkFailure);
    expect(failure?.event.type).toBe('agent-run-started');
  });

  it('fails fast for invalid identifiers and timestamps', () => {
    expect(() => createAgentTraceEmitter({ agentId: '', agentRunId: 'request-1' })).toThrowError(
      AgentObservabilityError
    );
    expect(() =>
      createAgentTraceEmitter({
        agentId: 'assistant',
        agentRunId: 'request-1',
        clock: () => -1,
      })
    ).toThrowError(AgentObservabilityError);
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
