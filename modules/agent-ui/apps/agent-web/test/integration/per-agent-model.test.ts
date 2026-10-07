// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationInteractionEvent } from '@ta-agent/ui-contracts';
import type { AgentWebConfig } from '../../src/application/agent-config.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { providerServer } from '../support/provider-server.js';
import { providerConfig } from '../support/agent-config.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function value<T>(
  result: { status: 'succeeded'; value: T } | { status: 'failed'; failure: unknown }
): T {
  if (result.status === 'failed') throw new Error(JSON.stringify(result.failure));
  return result.value;
}
function credential(config: AgentWebConfig, name: string): AgentWebConfig {
  if (config.model.kind !== 'provider') throw new Error('Fixture provider required');
  return {
    ...config,
    model: {
      ...config.model,
      credential: { reference: name, environmentVariable: name },
      config: {
        ...config.model.config,
        reference: { ...config.model.config.reference, credentialRef: name },
      },
    },
  };
}
async function interact(ports: ReturnType<typeof createAgentBaseWebPorts>, agentId: string) {
  const events: ConversationInteractionEvent[] = [];
  await ports.conversations.streamInteraction(
    { agentId, interactionId: crypto.randomUUID(), message: 'Hello' },
    (event) => {
      events.push(event);
      return Promise.resolve();
    }
  );
  return events;
}
async function fixtureHost() {
  const root = await mkdtemp(join(tmpdir(), 'agent-web-model-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const options = {
    persistence: { kind: 'directory' as const, rootDirectory: root },
    readEnvironmentVariable: (name: string) =>
      name === 'ALPHA_KEY' ? 'private-alpha' : name === 'BETA_KEY' ? 'private-beta' : undefined,
  };
  const backend = createAgentBaseWebPorts(options);
  const server = await startLocalAgentWebServer({ ports: backend });
  cleanup.push(server.close);
  return {
    root,
    backend,
    options,
    ports: createHttpAgentWebPorts({ baseUrl: `${server.origin}/api` }),
  };
}

describe('per-Agent provider composition through real Pi and local transport', () => {
  it('does not certify an obsolete revision when config changes during a probe', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const provider = await providerServer({
      tools: false,
      beforeResponse: () => {
        entered.resolve();
        return release.promise;
      },
    });
    cleanup.push(provider.close);
    const { ports, backend } = await fixtureHost();
    const created = value(
      await ports.agents.createAgent({
        identity: { agentId: 'probe-change', displayName: 'Probe change' },
        config: providerConfig(provider.baseUrl),
      })
    );
    const probe = backend.agents.testModelConnection({
      agentId: 'probe-change',
      expectedRevision: created.config.revision,
    });
    try {
      await entered.promise;
      value(
        await ports.agents.updateAgentConfig({
          agentId: 'probe-change',
          expectedRevision: created.config.revision,
          config: { ...created.config.value, instructions: 'New revision' },
        })
      );
    } finally {
      release.resolve();
    }
    expect(await probe).toMatchObject({ status: 'failed', failure: { code: 'revision-conflict' } });
    expect(
      value(await ports.sessions.listSessions({ agentId: 'probe-change', status: 'active' }))
        .records
    ).toHaveLength(0);
  });

  it('cancels a user-triggered probe and applies provider liveness without Session writes', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const provider = await providerServer({
      tools: false,
      beforeResponse: () => {
        entered.resolve();
        return release.promise;
      },
    });
    cleanup.push(provider.close);
    const { ports, backend } = await fixtureHost();
    const created = value(
      await ports.agents.createAgent({
        identity: { agentId: 'probe-cancel', displayName: 'Probe cancel' },
        config: providerConfig(provider.baseUrl),
      })
    );
    const controller = new AbortController();
    const probe = backend.agents.testModelConnection({
      agentId: 'probe-cancel',
      expectedRevision: created.config.revision,
      signal: controller.signal,
    });
    const cancelled = expect(probe).rejects.toThrow();
    try {
      await entered.promise;
      controller.abort(new DOMException('Cancelled by user', 'AbortError'));
      await cancelled;
      const updated = value(
        await ports.agents.updateAgentConfig({
          agentId: 'probe-cancel',
          expectedRevision: created.config.revision,
          config: {
            ...created.config.value,
            execution: { ...created.config.value.execution, responseStartTimeoutMilliseconds: 20 },
          },
        })
      );
      expect(
        await backend.agents.testModelConnection({
          agentId: 'probe-cancel',
          expectedRevision: updated.revision,
        })
      ).toMatchObject({
        status: 'failed',
        failure: {
          code: 'operation-failed',
          message: 'The provider did not start responding before its configured deadline.',
        },
      });
      expect(
        value(await ports.sessions.listSessions({ agentId: 'probe-cancel', status: 'active' }))
          .records
      ).toHaveLength(0);
    } finally {
      release.resolve();
    }
  });

  it('persists independent targets and environment references, with no model call on save/load', async () => {
    const alpha = await providerServer({ tools: false, responseText: 'Alpha answer' });
    const beta = await providerServer({ tools: false, responseText: 'Beta answer' });
    cleanup.push(alpha.close, beta.close);
    const { ports, options, root } = await fixtureHost();
    const first = value(
      await ports.agents.createAgent({
        identity: { agentId: 'alpha', displayName: 'Alpha' },
        config: credential(providerConfig(alpha.baseUrl, 'model-alpha'), 'ALPHA_KEY'),
      })
    );
    value(
      await ports.agents.createAgent({
        identity: { agentId: 'beta', displayName: 'Beta' },
        config: credential(providerConfig(beta.baseUrl, 'model-beta'), 'BETA_KEY'),
      })
    );
    expect(alpha.requests).toHaveLength(0);
    expect(beta.requests).toHaveLength(0);
    expect(value(await ports.agents.inspectModel({ agentId: 'alpha' })).status).toBe('configured');
    const restarted = createAgentBaseWebPorts(options);
    expect(value(await restarted.agents.readAgentConfig({ agentId: 'alpha' }))).toEqual(
      first.config
    );
    expect((await interact(restarted, 'alpha')).at(-1)).toMatchObject({
      type: 'completed',
      turn: { assistantMessage: { text: 'Alpha answer' } },
    });
    expect((await interact(restarted, 'beta')).at(-1)).toMatchObject({
      type: 'completed',
      turn: { assistantMessage: { text: 'Beta answer' } },
    });
    expect(alpha.authorization).toEqual(['Bearer private-alpha']);
    expect(beta.authorization).toEqual(['Bearer private-beta']);
    expect(alpha.requests[0]).toMatchObject({ model: 'model-alpha' });
    expect(beta.requests[0]).toMatchObject({ model: 'model-beta' });
    expect(JSON.stringify(await ports.agents.inspectAgent({ agentId: 'alpha' }))).not.toContain(
      'private-alpha'
    );
    for (const id of ['alpha', 'beta']) {
      for (const file of await readdir(join(root, id))) {
        const bytes = await readFile(join(root, id, file));
        expect(
          bytes.includes(Buffer.from('private-alpha')) ||
            bytes.includes(Buffer.from('private-beta'))
        ).toBe(false);
      }
    }
  });
  it('does not manufacture model readiness and probes explicitly without Session writes', async () => {
    const provider = await providerServer({ tools: false });
    cleanup.push(provider.close);
    const { ports, backend } = await fixtureHost();
    value(
      await ports.agents.createAgent({
        identity: { agentId: 'blank', displayName: 'Blank' },
        config: DEFAULT_AGENT_CONFIG,
      })
    );
    expect(value(await ports.agents.inspectModel({ agentId: 'blank' })).status).toBe(
      'unconfigured'
    );
    expect((await interact(backend, 'blank')).at(-1)).toMatchObject({ type: 'failed' });
    const created = value(
      await ports.agents.createAgent({
        identity: { agentId: 'probe', displayName: 'Probe' },
        config: providerConfig(provider.baseUrl),
      })
    );
    expect(provider.requests).toHaveLength(0);
    expect(
      value(
        await ports.agents.testModelConnection({
          agentId: 'probe',
          expectedRevision: created.config.revision,
        })
      ).revision
    ).toBe(created.config.revision);
    expect(provider.requests).toHaveLength(1);
    expect(
      value(await ports.sessions.listSessions({ agentId: 'probe', status: 'active' })).records
    ).toHaveLength(0);
    value(
      await ports.agents.updateAgentConfig({
        agentId: 'probe',
        expectedRevision: created.config.revision,
        config: { ...created.config.value, instructions: 'Changed' },
      })
    );
    expect(
      await ports.agents.testModelConnection({
        agentId: 'probe',
        expectedRevision: created.config.revision,
      })
    ).toMatchObject({ status: 'failed', failure: { code: 'revision-conflict' } });
    expect(provider.requests).toHaveLength(1);
    const missing = credential(providerConfig(provider.baseUrl), 'MISSING_KEY');
    value(
      await ports.agents.createAgent({
        identity: { agentId: 'missing', displayName: 'Missing' },
        config: missing,
      })
    );
    expect(value(await ports.agents.inspectModel({ agentId: 'missing' })).status).toBe(
      'credential-unavailable'
    );
  });
  it('freezes admitted config while new work adopts the updated target', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const old = await providerServer({
      tools: false,
      responseText: 'Old answer',
      beforeResponse: () => {
        entered.resolve();
        return release.promise;
      },
    });
    const next = await providerServer({ tools: false, responseText: 'New answer' });
    cleanup.push(old.close, next.close);
    const { ports, backend } = await fixtureHost();
    const created = value(
      await ports.agents.createAgent({
        identity: { agentId: 'changing', displayName: 'Changing' },
        config: providerConfig(old.baseUrl),
      })
    );
    const running = interact(backend, 'changing');
    try {
      await entered.promise;
      value(
        await ports.agents.updateAgentConfig({
          agentId: 'changing',
          expectedRevision: created.config.revision,
          config: providerConfig(next.baseUrl),
        })
      );
    } finally {
      release.resolve();
    }
    expect((await running).at(-1)).toMatchObject({
      type: 'completed',
      turn: { assistantMessage: { text: 'Old answer' } },
    });
    expect((await interact(backend, 'changing')).at(-1)).toMatchObject({
      type: 'completed',
      turn: { assistantMessage: { text: 'New answer' } },
    });
    expect(old.requests).toHaveLength(1);
    expect(next.requests).toHaveLength(1);
  });
  it('propagates cancellation and configured invocation deadlines without changing null defaults', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const provider = await providerServer({
      tools: false,
      beforeResponse: () => {
        entered.resolve();
        return release.promise;
      },
    });
    cleanup.push(provider.close);
    const { ports, backend } = await fixtureHost();
    const created = value(
      await ports.agents.createAgent({
        identity: { agentId: 'slow', displayName: 'Slow' },
        config: providerConfig(provider.baseUrl),
      })
    );
    const controller = new AbortController();
    const events: ConversationInteractionEvent[] = [];
    const running = backend.conversations.streamInteraction(
      { agentId: 'slow', interactionId: 'cancel', message: 'Wait', signal: controller.signal },
      (event) => {
        events.push(event);
        return Promise.resolve();
      }
    );
    await entered.promise;
    controller.abort();
    await running;
    expect(events.at(-1)?.type).toBe('cancelled');
    value(
      await ports.agents.updateAgentConfig({
        agentId: 'slow',
        expectedRevision: created.config.revision,
        config: {
          ...created.config.value,
          execution: { ...created.config.value.execution, actorTimeoutMilliseconds: 20 },
        },
      })
    );
    try {
      expect((await interact(backend, 'slow')).at(-1)?.type).toBe('failed');
    } finally {
      release.resolve();
    }
  });
});
