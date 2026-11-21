import { describe, expect, it } from 'vitest';
import {
  AgentObservabilityError,
  createAgentTraceEmitter,
  type AgentTraceEvent,
  validateAgentTraceEvent,
  validateAgentTraceEventDetails,
} from '../../../src/index.js';
import { TRACE_EVENT_EXAMPLES } from '../../fixtures/trace-events.js';

const envelope = {
  schemaVersion: 2,
  agentId: 'agent',
  agentRunId: 'run',
  sequence: 1,
  timestamp: 0,
};

describe('Trace event protocol', () => {
  it.each(TRACE_EVENT_EXAMPLES)(
    'accepts complete $type metadata and its persisted envelope',
    (details) => {
      expect(() => validateAgentTraceEventDetails(details)).not.toThrow();
      expect(() => validateAgentTraceEvent({ ...envelope, ...details })).not.toThrow();
    }
  );

  it.each(TRACE_EVENT_EXAMPLES)('rejects missing, null and unknown fields in $type', (details) => {
    for (const key of Object.keys(details)) {
      if (key !== 'parentRunId') {
        const incomplete: Record<string, unknown> = { ...details };
        delete incomplete[key];
        expect(() => validateAgentTraceEventDetails(incomplete)).toThrowError(
          AgentObservabilityError
        );
        expect(() => validateAgentTraceEvent({ ...envelope, ...incomplete })).toThrowError(
          AgentObservabilityError
        );
      }
      const invalid = { ...details, [key]: null };
      expect(() => validateAgentTraceEventDetails(invalid)).toThrowError(AgentObservabilityError);
      expect(() => validateAgentTraceEvent({ ...envelope, ...invalid })).toThrowError(
        AgentObservabilityError
      );
    }
    expect(() => validateAgentTraceEventDetails({ ...details, extra: 'private' })).toThrowError(
      AgentObservabilityError
    );
    expect(() =>
      validateAgentTraceEvent({ ...envelope, ...details, extra: 'private' })
    ).toThrowError(AgentObservabilityError);
  });

  it.each([null, undefined, [], 'event', 42, { type: 'unknown' }])(
    'rejects non-event inputs: %j',
    (value) => {
      expect(() => validateAgentTraceEventDetails(value)).toThrowError(AgentObservabilityError);
      expect(() => validateAgentTraceEvent(value)).toThrowError(AgentObservabilityError);
    }
  );

  it('rejects explicitly undefined optional fields and invalid persisted envelopes', () => {
    const details = { type: 'agent-run-started', operationName: 'test' };
    expect(() =>
      validateAgentTraceEventDetails({ ...details, parentRunId: undefined })
    ).toThrowError(AgentObservabilityError);
    for (const [key, invalid] of [
      ['schemaVersion', 1],
      ['agentId', ''],
      ['agentRunId', 'x'.repeat(257)],
      ['sequence', 0],
      ['sequence', 1.5],
      ['timestamp', -1],
      ['timestamp', Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      expect(() =>
        validateAgentTraceEvent({ ...envelope, ...details, [key]: invalid })
      ).toThrowError(AgentObservabilityError);
    }
    for (const key of Object.keys(envelope)) {
      const incomplete: Record<string, unknown> = { ...envelope, ...details };
      delete incomplete[key];
      expect(() => validateAgentTraceEvent(incomplete)).toThrowError(AgentObservabilityError);
    }
  });
});

describe('Trace event protocol regressions', () => {
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
