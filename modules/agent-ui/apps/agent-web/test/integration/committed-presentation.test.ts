// @vitest-environment node
import { expect, it } from 'vitest';
import type { ConversationInteractionEvent } from '@ta-agent/ui-contracts';
import {
  createSubmittingInteraction,
  executeConversationInteraction,
} from '@ta-agent/ui-workspace/testing';
import {
  createWebBackendServices,
  type WebBackendServices,
} from '../../src/node/agent-base/profile.js';
import { createWebConversationManagement } from '../../src/node/agent-base/conversations.js';
import { createWebAgentManagement } from '../../src/node/agent-base/agents.js';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { engineConfig } from '../support/agent-config.js';
import { createWebSessionManagement } from '../../src/node/agent-base/sessions.js';

const boundaries = ['session-port', 'snapshot', 'presentation-port', 'presentation'] as const;
type Boundary = (typeof boundaries)[number];
type Mode = 'slow' | 'failed';
const cases = boundaries.flatMap((boundary) =>
  (['slow', 'failed'] as const).map((mode) => ({ boundary, mode }))
);

function unavailable<Value>(mode: Mode): Promise<Value> {
  return mode === 'failed'
    ? Promise.reject(new Error('private projection details'))
    : new Promise(() => {});
}

function projectionFailure(services: WebBackendServices, boundary: Boundary, mode: Mode) {
  let portReads = 0;
  return createWebConversationManagement({
    ...services,
    sessionFor: async (id) => {
      portReads++;
      if (boundary === 'session-port' || (boundary === 'presentation-port' && portReads === 2))
        return unavailable(mode);
      const session = await services.sessionFor(id);
      return {
        ...session,
        inspect: (input) => (boundary === 'snapshot' ? unavailable(mode) : session.inspect(input)),
        readTurnPresentation: (input) =>
          boundary === 'presentation' ? unavailable(mode) : session.readTurnPresentation(input),
      };
    },
  });
}

it.each(cases)(
  'reports a precise durable receipt when $boundary is $mode',
  async ({ boundary, mode }) => {
    const services = createWebBackendServices({
      engine: createOfflineWebEngine(),
      persistence: { kind: 'memory' },
      presentationWaitMilliseconds: 5,
    });
    // The management service and conversation adapter intentionally share one authority definition.
    const created = await createWebAgentManagement(services).createAgent({
      identity: { agentId: 'projection', displayName: 'Projection' },
      config: engineConfig(),
    });
    expect(created.status).toBe('succeeded');
    const port = projectionFailure(services, boundary, mode);
    const events: ConversationInteractionEvent[] = [];
    await port.streamInteraction(
      { agentId: 'projection', interactionId: 'display-recovery', message: 'hello' },
      (event) => {
        events.push(event);
        return Promise.resolve();
      }
    );
    const terminal = events.at(-1);
    expect(terminal?.type).toBe('committed');
    if (terminal?.type !== 'committed') throw new Error('Missing receipt');
    const saved = await createWebConversationManagement(services).readConversation({
      agentId: 'projection',
      sessionId: terminal.receipt.sessionId,
      branchId: terminal.receipt.branchId,
    });
    expect(saved).toMatchObject({
      status: 'succeeded',
      value: { turns: [{ turnId: terminal.receipt.turnId, status: 'completed' }] },
    });
    expect(JSON.stringify(terminal)).not.toContain('private');
  },
  1_000
);

it.each(cases)(
  'accepts an idempotent replay receipt when $boundary is $mode without a new admission or Turn',
  async ({ boundary, mode }) => {
    const services = createWebBackendServices({
      engine: createOfflineWebEngine(),
      persistence: { kind: 'memory' },
      presentationWaitMilliseconds: 5,
    });
    expect(
      (
        await createWebAgentManagement(services).createAgent({
          identity: { agentId: 'replay', displayName: 'Replay' },
          config: engineConfig(),
        })
      ).status
    ).toBe('succeeded');
    const healthy = createWebConversationManagement(services);
    const initialEvents: ConversationInteractionEvent[] = [];
    await healthy.streamInteraction(
      { agentId: 'replay', interactionId: 'seed', message: 'first' },
      (event) => {
        initialEvents.push(event);
        return Promise.resolve();
      }
    );
    const initial = initialEvents.at(-1);
    if (initial?.type !== 'completed') throw new Error('Missing initial Turn.');
    const inspected = await createWebSessionManagement(services).inspectSessionNavigation({
      agentId: 'replay',
      sessionId: initial.sessionId,
    });
    if (inspected.status !== 'succeeded') throw new Error('Missing navigation.');
    const request = {
      agentId: 'replay',
      interactionId: 'stable-key',
      message: 'second',
      session: {
        sessionId: initial.sessionId,
        branchId: inspected.value.selectedBranchId,
        navigationRevision: inspected.value.revision,
      },
    };
    const live: ConversationInteractionEvent[] = [];
    await healthy.streamInteraction(request, (event) => {
      live.push(event);
      return Promise.resolve();
    });
    const original = live.at(-1);
    if (original?.type !== 'completed') throw new Error('Missing original completion.');
    const failing = projectionFailure(services, boundary, mode);
    const replay: ConversationInteractionEvent[] = [];
    const state = await executeConversationInteraction({
      initial: createSubmittingInteraction({ ...request, timestamp: new Date().toISOString() }),
      request,
      management: {
        ...failing,
        streamInteraction: (input, consume) =>
          failing.streamInteraction(input, async (event) => {
            replay.push(event);
            await consume(event);
          }),
      },
      isCurrent: () => true,
      onAdmission: () => {
        throw new Error('Replay must not fabricate admission.');
      },
      onProgress: () => {},
    });
    expect(replay.map((event) => event.type)).toEqual(['interaction-started', 'committed']);
    expect(state).toMatchObject({
      status: 'committed',
      receipt: {
        sessionId: original.sessionId,
        branchId: original.turn.branchId,
        turnId: original.turn.turnId,
      },
    });
    const saved = await healthy.readConversation({
      agentId: 'replay',
      sessionId: original.sessionId,
      branchId: original.turn.branchId,
    });
    expect(saved).toMatchObject({
      status: 'succeeded',
      value: { turns: [initial.turn, original.turn] },
    });
    expect(JSON.stringify(state)).not.toContain('private');
  },
  1_000
);

it('validates the application projection budget without changing model timeout configuration', () => {
  expect(() =>
    createAgentBaseWebPorts({
      engine: createOfflineWebEngine(),
      persistence: { kind: 'memory' },
      presentationWaitMilliseconds: 0,
    })
  ).toThrow('Presentation wait');
});

it.each(['resolve', 'reject'] as const)(
  'does not publish another terminal when a timed-out snapshot later %ss',
  async (settlement) => {
    const services = createWebBackendServices({
      engine: createOfflineWebEngine(),
      persistence: { kind: 'memory' },
      presentationWaitMilliseconds: 5,
    });
    await createWebAgentManagement(services).createAgent({
      identity: { agentId: 'late', displayName: 'Late' },
      config: engineConfig(),
    });
    const gate = Promise.withResolvers<void>();
    const port = createWebConversationManagement({
      ...services,
      sessionFor: async (id) => {
        const session = await services.sessionFor(id);
        return {
          ...session,
          inspect: async (input) => {
            await gate.promise;
            return session.inspect(input);
          },
        };
      },
    });
    const events: ConversationInteractionEvent[] = [];
    await port.streamInteraction(
      { agentId: 'late', interactionId: 'late', message: 'hello' },
      (event) => {
        events.push(event);
        return Promise.resolve();
      }
    );
    expect(events.at(-1)?.type).toBe('committed');
    const before = [...events];
    if (settlement === 'resolve') gate.resolve();
    else gate.reject(new Error('Late private read failure.'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(before);
  },
  1_000
);
