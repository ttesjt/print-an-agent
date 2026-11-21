import { expect, it } from 'vitest';
import * as observability from '@print-an-agent/base-observability';
import type { AgentTraceEvent } from '@print-an-agent/base-observability';

it('exposes only the deliberate runtime API through the compiled package entry', () => {
  expect(Object.keys(observability).sort()).toEqual(
    [
      'AgentObservabilityError',
      'NOOP_AGENT_TRACE_SINK',
      'createAgentTraceEmitter',
      'traceErrorCode',
      'validateAgentTraceEvent',
      'validateAgentTraceEventDetails',
    ].sort()
  );
});

it('delivers public event types through a consumer-supplied sink and validates the result', async () => {
  const events: AgentTraceEvent[] = [];
  const trace = observability.createAgentTraceEmitter({
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
  await trace.record({ type: 'agent-run-started', operationName: 'test' });
  expect(events).toHaveLength(1);
  expect(() => observability.validateAgentTraceEvent(events[0])).not.toThrow();
  expect(events[0]).toMatchObject({ schemaVersion: 2, agentId: 'agent', sequence: 1 });
});
