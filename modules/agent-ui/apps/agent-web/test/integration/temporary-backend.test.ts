// @vitest-environment node
import { expect, it } from 'vitest';
import type { ActorEngineStreamingRequest } from '@print-an-agent/model-invocation-core';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createWebBackendServices } from '../../src/node/agent-base/profile.js';
import { createWebTemporaryConversationPort } from '../../src/node/agent-base/temporary-conversation/service.js';
import { DEFAULT_AGENT_CONFIG, type AgentWebConfig } from '../../src/application/agent-config.js';
import type {
  TemporaryConversationEvent,
  TemporaryConversationRequest,
} from '../../src/temporary-conversation/contracts.js';
import { temporaryEngine, temporaryMessage } from '../support/temporary-model.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { engineConfig, providerConfig } from '../support/agent-config.js';

const config: AgentWebConfig = {
  ...DEFAULT_AGENT_CONFIG,
  model: { kind: 'engine', engineId: 'temporary.fixture' },
};
const input: TemporaryConversationRequest = {
  agentId: 'demo',
  interactionId: 'send',
  expectedConfigRevision: '1',
  message: 'hello',
  history: [],
};
async function fixture(engine = temporaryEngine(), configuration = config) {
  const ports = createAgentBaseWebPorts({ persistence: { kind: 'memory' }, engine });
  const created = await ports.agents.createAgent({
    identity: { agentId: 'demo', displayName: 'Demo' },
    config: configuration,
  });
  if (created.status !== 'succeeded' || ports.temporaryConversations === undefined)
    throw new Error('Fixture setup failed');
  const run = async (request = input, signal?: AbortSignal) => {
    const events: TemporaryConversationEvent[] = [];
    await ports.temporaryConversations?.streamTemporaryConversation(
      { ...request, ...(signal === undefined ? {} : { signal }) },
      (event) => {
        events.push(event);
        return Promise.resolve();
      }
    );
    return events;
  };
  return { ports, created: created.value, run };
}

it('uses published model settings and caller transcript without creating Sessions', async () => {
  const requests: ActorEngineStreamingRequest[] = [];
  const f = await fixture(
    temporaryEngine(async (request) => {
      requests.push(request);
      await request.emit({ type: 'reasoning-delta', delta: 'private reasoning' });
      await request.emit({ type: 'text-delta', delta: 'answer' });
      await request.emit({ type: 'assistant-complete', message: temporaryMessage() });
      return { message: temporaryMessage() };
    })
  );
  const first = await f.run();
  const second = await f.run({
    ...input,
    interactionId: 'second',
    history: [{ user: 'hello', assistant: 'answer' }],
  });
  expect(first.map((e) => e.type)).toEqual([
    'opened',
    'reasoning-delta',
    'text-delta',
    'completed',
  ]);
  expect(second.at(-1)).toMatchObject({
    type: 'completed',
    configRevision: '1',
    assistant: {
      text: 'answer',
      reasoningBlocks: [{ modelTurnIndex: 1, text: 'private reasoning' }],
    },
  });
  expect(requests[0]?.instructions).toContain(config.instructions);
  expect(requests[0]?.instructions).toContain('Response style: balanced');
  expect(requests[1]?.messages).toMatchObject([
    { role: 'context' },
    { role: 'user', text: 'hello' },
  ]);
  const context = requests[1]?.messages[0]?.text ?? '';
  expect(JSON.parse(context)).toEqual({
    kind: 'caller-provided-temporary-transcript',
    turns: [{ user: 'hello', assistant: 'answer' }],
  });
  expect(context).not.toContain('private reasoning');
  expect(JSON.stringify(second)).not.toContain('do-not-project');
  expect(await f.ports.sessions.listSessions({ agentId: 'demo', status: 'active' })).toMatchObject({
    status: 'succeeded',
    value: { records: [] },
  });
});

it('cannot use runtime or Session services through its narrow dependency port', async () => {
  const services = createWebBackendServices({
    persistence: { kind: 'memory' },
    engine: temporaryEngine(),
  });
  await services.agents.create({ identity: { id: 'demo' }, config });
  let inspections = 0;
  const port = createWebTemporaryConversationPort({
    agents: {
      inspect: (...args) => {
        inspections++;
        return services.agents.inspect(...args);
      },
    },
    modelHost: services.modelHost,
  });
  const events: TemporaryConversationEvent[] = [];
  await port.streamTemporaryConversation(input, (event) => {
    events.push(event);
    return Promise.resolve();
  });
  expect(inspections).toBe(1);
  expect(events.at(-1)?.type).toBe('completed');
});

it('rejects obsolete config and disabled targets before invoking the model', async () => {
  let calls = 0;
  const f = await fixture(
    temporaryEngine(() => {
      calls++;
      return Promise.reject(new Error('must not invoke'));
    })
  );
  await f.ports.agents.updateAgentConfig({
    agentId: 'demo',
    expectedRevision: '1',
    config: { ...config, instructions: 'changed' },
  });
  expect((await f.run()).at(-1)).toMatchObject({
    type: 'failed',
    failure: { code: 'TEMPORARY_CONFIG_CONFLICT' },
  });
  await f.ports.agents.disableAgent({
    agentId: 'demo',
    expectedRevision: f.created.details.identityRevision,
  });
  expect((await f.run({ ...input, expectedConfigRevision: '2' })).at(-1)).toMatchObject({
    type: 'failed',
    failure: { code: 'TEMPORARY_TARGET_DISABLED' },
  });
  expect(calls).toBe(0);
});

it('keeps the admitted config snapshot during an update and blocks the next old revision', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const f = await fixture(
    temporaryEngine(async (request) => {
      started.resolve();
      await release.promise;
      expect(request.instructions).toContain(config.instructions);
      await request.emit({ type: 'assistant-complete', message: temporaryMessage() });
      return { message: temporaryMessage() };
    })
  );
  const pending = f.run();
  await started.promise;
  await f.ports.agents.updateAgentConfig({
    agentId: 'demo',
    expectedRevision: '1',
    config: { ...config, instructions: 'new' },
  });
  release.resolve();
  expect((await pending).at(-1)).toMatchObject({ type: 'completed', configRevision: '1' });
  expect((await f.run()).at(-1)).toMatchObject({
    type: 'failed',
    failure: { code: 'TEMPORARY_CONFIG_CONFLICT' },
  });
});

it.each(['request', 'actor'] as const)('retains the %s deadline owner', async (owner) => {
  const f = await fixture(
    temporaryEngine(async (request) => {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      request.signal.throwIfAborted();
      return { message: temporaryMessage() };
    }),
    {
      ...config,
      execution: {
        ...config.execution,
        requestTimeoutMilliseconds: owner === 'request' ? 5 : null,
        actorTimeoutMilliseconds: owner === 'actor' ? 5 : null,
      },
    }
  );
  expect((await f.run()).at(-1)).toMatchObject({
    type: 'failed',
    failure: { code: owner === 'request' ? 'REQUEST_TIMEOUT' : 'ACTOR_INVOCATION_TIMEOUT' },
  });
});

it('never publishes another terminal when the completed consumer rejects', async () => {
  const f = await fixture();
  const events: TemporaryConversationEvent[] = [];
  const cause = new Error('receiver failed');
  await expect(
    f.ports.temporaryConversations?.streamTemporaryConversation(input, (event) => {
      events.push(event);
      if (event.type === 'completed') throw cause;
      return Promise.resolve();
    })
  ).rejects.toBe(cause);
  expect(events.filter((e) => ['completed', 'failed', 'cancelled'].includes(e.type))).toHaveLength(
    1
  );
});

it('rejects unknown input fields before execution', async () => {
  const f = await fixture();
  await expect(
    f.ports.temporaryConversations?.streamTemporaryConversation(
      { ...input, ...{ provider: 'forbidden' } },
      () => Promise.resolve()
    )
  ).rejects.toMatchObject({ code: 'WEB_TRANSPORT_INVALID' });
});

it('rejects unavailable configuration and unsupported streaming without fallback', async () => {
  const unconfigured = await fixture(temporaryEngine(), DEFAULT_AGENT_CONFIG);
  expect((await unconfigured.run()).at(-1)).toMatchObject({
    type: 'failed',
    failure: { code: 'WEB_MODEL_UNAVAILABLE' },
  });
  const interactionOnly = await fixture(createOfflineWebEngine(), engineConfig());
  expect((await interactionOnly.run()).at(-1)).toMatchObject({
    type: 'failed',
    failure: { code: 'REQUEST_CONFIGURATION_INVALID' },
  });
  const provider = providerConfig('http://127.0.0.1:1/v1');
  if (provider.model.kind !== 'provider') throw new Error('Expected provider fixture');
  const missingCredential = await fixture(temporaryEngine(), {
    ...provider,
    model: {
      ...provider.model,
      config: {
        ...provider.model.config,
        reference: { ...provider.model.config.reference, credentialRef: 'missing' },
      },
      credential: { reference: 'missing', environmentVariable: 'MISSING' },
    },
  });
  expect((await missingCredential.run()).at(-1)).toMatchObject({
    type: 'failed',
    failure: { code: 'WEB_MODEL_UNAVAILABLE' },
  });
});

it('cancels and drains the Engine before publishing cancellation', async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  const f = await fixture(
    temporaryEngine(async (request) => {
      started.resolve(request.signal);
      await release.promise;
      request.signal.throwIfAborted();
      return { message: temporaryMessage() };
    })
  );
  const controller = new AbortController();
  let settled = false;
  const pending = f.run(input, controller.signal).finally(() => {
    settled = true;
  });
  const signal = await started.promise;
  controller.abort(new Error('caller cancelled'));
  expect(signal.aborted).toBe(true);
  expect(settled).toBe(false);
  release.resolve();
  expect((await pending).at(-1)?.type).toBe('cancelled');
});
