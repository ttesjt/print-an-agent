// @vitest-environment node
import { expect, it, onTestFinished } from 'vitest';
import type { ConversationInteractionEvent } from '@ta-agent/ui-contracts';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { providerConfig } from '../support/agent-config.js';
import { providerServer } from '../support/provider-server.js';
import { memoryOptions } from '../support/memory.js';

it('uses the declared Web Session authority for optional Memory tools and out-of-band fork over HTTP', async () => {
  const provider = await providerServer({
    toolCall: {
      name: 'apply_context_memory',
      arguments: {
        expectedRevision: 1,
        commands: [{ op: 'add', itemId: '', content: 'web remembered' }],
      },
    },
  });
  onTestFinished(() => provider.close());
  const base = memoryOptions().options;
  const backend = createAgentBaseWebPorts({
    persistence: { kind: 'memory' },
    memory: {
      ...base,
      provisioning: {
        ...base.provisioning,
        context: { ...base.provisioning.context, runtime: { writable: true } },
      },
    },
  });
  const server = await startLocalAgentWebServer({
    ports: backend,
    closeResources: () => backend.close(),
  });
  onTestFinished(() => server.close());
  const ports = createHttpAgentWebPorts({ baseUrl: server.origin + '/api' });
  const created = await ports.agents.createAgent({
    identity: { agentId: 'memory-web', displayName: 'Memory' },
    config: providerConfig(provider.baseUrl),
  });
  expect(created.status).toBe('succeeded');
  const firstEvents: ConversationInteractionEvent[] = [];
  await ports.conversations.streamInteraction(
    { agentId: 'memory-web', interactionId: 'first', message: 'remember' },
    (event) => {
      firstEvents.push(event);
      return Promise.resolve();
    }
  );
  const first = firstEvents.at(-1);
  expect(first?.type).toBe('completed');
  if (first?.type !== 'completed') throw new Error(JSON.stringify(first));
  expect(firstEvents.some((e) => e.type === 'tool-activity-updated')).toBe(true);
  const ref = { agentId: 'memory-web', sessionId: first.sessionId };
  const nav = await ports.sessions.inspectSessionNavigation(ref);
  if (nav.status !== 'succeeded') throw new Error('Navigation failed');
  const fork = await ports.conversations.forkSessionBranch({
    ...ref,
    sourceBranchId: nav.value.selectedBranchId,
    throughTurnId: first.turn.turnId,
    expectedRevision: nav.value.revision,
  });
  expect(fork.status).toBe('succeeded');
  if (fork.status !== 'succeeded') throw new Error('Fork failed');
  const selected = await ports.sessions.selectSessionBranch({
    ...ref,
    branchId: fork.value.affectedBranchId,
    expectedRevision: fork.value.navigation.revision,
  });
  if (selected.status !== 'succeeded') throw new Error('Selection failed');
  const nextEvents: ConversationInteractionEvent[] = [];
  await ports.conversations.streamInteraction(
    {
      agentId: 'memory-web',
      interactionId: 'next',
      message: 'recall',
      session: {
        sessionId: first.sessionId,
        branchId: selected.value.selectedBranchId,
        navigationRevision: selected.value.revision,
      },
    },
    (event) => {
      nextEvents.push(event);
      return Promise.resolve();
    }
  );
  expect(nextEvents.at(-1)?.type).toBe('completed');
  expect(JSON.stringify(provider.requests.at(-1))).toContain('web remembered');
});
