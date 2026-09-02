import { describe, expect, it } from 'vitest';
import { AgentObservabilityError, createAgentTraceEmitter } from '@ta-agent/base-observability';
import { MemoryAgentTraceAdapter } from '../../src/index.js';

describe('MemoryAgentTraceAdapter', () => {
  it('keeps a bounded immutable ring and reports exact drops', async () => {
    const adapter = new MemoryAgentTraceAdapter({ maxEvents: 2 });
    const trace = createAgentTraceEmitter({
      agentId: 'assistant',
      agentRunId: 'request-1',
      sink: adapter,
      clock: () => 1,
    });

    await trace.record({ type: 'agent-run-started', operationName: 'test' });
    await trace.record({ type: 'workflow-run-skipped', workflowName: 'optional' });
    await trace.record({ type: 'agent-run-completed', operationName: 'test' });

    const snapshot = adapter.inspect();
    expect(snapshot.droppedEvents).toBe(1);
    expect(snapshot.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.events)).toBe(true);
  });

  it('filters detached snapshots by Agent Run ID', async () => {
    const adapter = new MemoryAgentTraceAdapter({ maxEvents: 4 });
    const first = createAgentTraceEmitter({
      agentId: 'assistant',
      agentRunId: 'first',
      sink: adapter,
      clock: () => 1,
    });
    const second = createAgentTraceEmitter({
      agentId: 'assistant',
      agentRunId: 'second',
      sink: adapter,
      clock: () => 1,
    });
    await first.record({ type: 'agent-run-started', operationName: 'test' });
    const snapshot = adapter.inspect({ agentRunId: 'first' });
    await second.record({ type: 'agent-run-started', operationName: 'test' });

    expect(snapshot.events).toHaveLength(1);
    expect(adapter.inspect({ agentRunId: 'second' }).events).toHaveLength(1);
  });

  it('stores a detached immutable event value', async () => {
    const adapter = new MemoryAgentTraceAdapter({ maxEvents: 2 });
    const event = {
      schemaVersion: 1,
      agentId: 'assistant',
      agentRunId: 'request-1',
      sequence: 1,
      timestamp: 1,
      type: 'agent-run-started',
      operationName: 'test',
    } as const;

    await adapter.record(event);
    Reflect.set(event, 'timestamp', 2);

    expect(adapter.inspect().events[0]).toMatchObject({ timestamp: 1 });
    expect(Object.isFrozen(adapter.inspect().events[0])).toBe(true);
  });

  it('rejects unbounded memory configuration', () => {
    for (const maxEvents of [0, -1, 1.5, 100_001]) {
      expect(() => new MemoryAgentTraceAdapter({ maxEvents })).toThrowError(
        AgentObservabilityError
      );
    }
  });

  it('rejects malformed events at the adapter boundary', async () => {
    const adapter = new MemoryAgentTraceAdapter({ maxEvents: 2 });
    const record = adapter.record.bind(adapter);

    await expect(
      Reflect.apply(record, undefined, [
        {
          schemaVersion: 1,
          agentId: 'assistant',
          agentRunId: 'request-1',
          sequence: 1,
          timestamp: 1,
          type: 'agent-run-started',
          operationName: 'test',
          privateMessage: 'must not persist',
        },
      ])
    ).rejects.toMatchObject({ code: 'TRACE_EVENT_INVALID' });
    expect(adapter.inspect().events).toEqual([]);
  });
});
