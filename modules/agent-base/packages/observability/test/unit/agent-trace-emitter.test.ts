import { describe, expect, it } from 'vitest';
import {
  AgentObservabilityError,
  createAgentTraceEmitter,
  validateAgentTraceEvent,
  type AgentTraceEvent,
  type AgentTraceEventSink,
  type AgentTraceSinkFailure,
} from '../../src/index.js';

describe('Agent trace emitter', () => {
  it('requires full Workflow identity for skipped events at emitter and persistence boundaries', async () => {
    const trace = createAgentTraceEmitter({ agentId: 'agent', agentRunId: 'run' });
    const details = { type: 'workflow-run-skipped', workflowName: 'conditional' } as const;
    await expect(
      trace.record({ ...details, workflowRunId: 'workflow-run' })
    ).resolves.toBeUndefined();
    await expect(
      Reflect.apply(trace.record.bind(trace), undefined, [details])
    ).rejects.toMatchObject({ code: 'TRACE_EVENT_INVALID' });
    const envelope = {
      schemaVersion: 2,
      agentId: 'agent',
      agentRunId: 'run',
      sequence: 1,
      timestamp: 1,
    };
    expect(() => validateAgentTraceEvent({ ...envelope, ...details })).toThrowError(
      AgentObservabilityError
    );
    expect(() =>
      validateAgentTraceEvent({ ...envelope, ...details, workflowRunId: 'workflow-run' })
    ).not.toThrow();
  });
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
        schemaVersion: 2,
        agentId: 'assistant',
        agentRunId: 'request-1',
        sequence: 1,
        timestamp: 10,
        type: 'agent-run-started',
        operationName: 'test',
      },
      {
        schemaVersion: 2,
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

  it('accepts closed provenance summaries and rejects opaque evidence or contradictory fields', async () => {
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
    const common = {
      type: 'model-response-completed',
      workflowName: 'request',
      workflowRunId: 'workflow-1',
      modelTurnIndex: 1,
      engineId: 'custom-engine',
      stopReason: 'stop',
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 3,
      outputCharacters: 10,
    } as const;

    await trace.record({
      ...common,
      provenanceKind: 'engine-defined',
      provenanceType: 'example.runtime-target',
    });
    expect(events[0]).toMatchObject({
      engineId: 'custom-engine',
      provenanceKind: 'engine-defined',
      provenanceType: 'example.runtime-target',
    });

    const record = trace.record.bind(trace);
    await expect(
      Reflect.apply(record, undefined, [
        {
          ...common,
          provenanceKind: 'engine-defined',
          provenanceType: 'example.runtime-target',
          evidence: { private: 'must-not-enter-traces' },
        },
      ])
    ).rejects.toMatchObject({ code: 'TRACE_EVENT_INVALID' });
    await expect(
      Reflect.apply(record, undefined, [
        {
          ...common,
          provenanceKind: 'provider-model',
          provider: 'provider',
          model: 'model',
          provenanceType: 'contradictory',
        },
      ])
    ).rejects.toMatchObject({ code: 'TRACE_EVENT_INVALID' });
    for (const provenanceType of ['contains space', 'x'.repeat(129)]) {
      await expect(
        Reflect.apply(record, undefined, [
          {
            ...common,
            provenanceKind: 'engine-defined',
            provenanceType,
          },
        ])
      ).rejects.toMatchObject({ code: 'TRACE_EVENT_INVALID' });
    }
    expect(events).toHaveLength(1);
  });

  it('accepts only trace schema 2 and model-turn vocabulary', () => {
    const baseEnvelope = {
      agentId: 'assistant',
      agentRunId: 'request-1',
      sequence: 1,
      timestamp: 1,
    } as const;
    const currentEvent = {
      ...baseEnvelope,
      schemaVersion: 2,
      type: 'model-turn-started',
      workflowName: 'request',
      workflowRunId: 'workflow-1',
      modelTurnIndex: 1,
    } as const;

    expect(() => validateAgentTraceEvent(currentEvent)).not.toThrow();

    const obsoleteEvents: readonly unknown[] = [
      { ...currentEvent, schemaVersion: 1 },
      {
        ...baseEnvelope,
        schemaVersion: 2,
        type: 'provider-turn-started',
        workflowName: 'request',
        workflowRunId: 'workflow-1',
        turnIndex: 1,
      },
      {
        ...baseEnvelope,
        schemaVersion: 2,
        type: 'agent-loop-started',
        workflowName: 'request',
        workflowRunId: 'workflow-1',
        sessionId: 'session-1',
        maxProviderTurns: 4,
        maxOutputCharacters: 100,
      },
      {
        ...baseEnvelope,
        schemaVersion: 2,
        type: 'agent-loop-completed',
        workflowName: 'request',
        workflowRunId: 'workflow-1',
        providerTurns: 1,
        toolCalls: 0,
        totalToolResultCharacters: 0,
      },
    ];
    for (const event of obsoleteEvents) {
      expect(() => validateAgentTraceEvent(event)).toThrowError(AgentObservabilityError);
    }
  });
});
