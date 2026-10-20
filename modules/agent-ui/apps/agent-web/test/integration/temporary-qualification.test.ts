// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { TemporaryConversationController } from '../../src/temporary-conversation/controller.js';
import { providerConfig } from '../support/agent-config.js';
import { providerServer } from '../support/provider-server.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function value<T>(result: { status: 'succeeded'; value: T } | { status: 'failed' }): T {
  if (result.status === 'failed') throw new Error('Qualification operation failed');
  return result.value;
}
/** Read-only qualification of all existing authority tables; never provision Session resources. */
function databaseSnapshot(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = database
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all();
    return schema.map((table) => {
      if (typeof table.name !== 'string') throw new Error('Invalid fixture table');
      const identifier = `"${table.name.replaceAll('"', '""')}"`;
      return { schema: table, rows: database.prepare(`SELECT * FROM ${identifier}`).all() };
    });
  } finally {
    database.close();
  }
}

it('qualifies two browser-owned rounds through HTTP, actual Pi and SSE with no persistent writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'temporary-qualification-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const provider = await providerServer({ tools: false, responseText: 'Website answer' });
  cleanup.push(provider.close);
  const backend = createAgentBaseWebPorts({
    persistence: { kind: 'directory', rootDirectory: root },
  });
  const config = {
    ...providerConfig(provider.baseUrl),
    instructions: 'Explain the personal site.',
  };
  const created = value(
    await backend.agents.createAgent({
      identity: { agentId: 'website', displayName: 'Website' },
      config,
    })
  );
  const before = databaseSnapshot(join(root, 'website', 'agent.sqlite'));
  const server = await startLocalAgentWebServer({ ports: backend });
  cleanup.push(server.close);
  const ports = createHttpAgentWebPorts({ baseUrl: server.origin + '/api' });
  if (ports.temporaryConversations === undefined) throw new Error('Temporary port required');
  const controller = new TemporaryConversationController(ports.temporaryConversations);
  cleanup.push(() => controller.dispose());
  const target = {
    agentId: 'website',
    displayName: 'Website',
    configRevision: created.config.revision,
  };
  controller.open(target);
  controller.setDraft('Introduce yourself');
  await controller.send();
  controller.close();
  controller.open(target);
  controller.setDraft('Where can I see projects?');
  await controller.send();
  expect(controller.getSnapshot().turns).toMatchObject([
    {
      status: 'completed',
      text: 'Website answer',
      reasoning: [{ modelTurnIndex: 1, text: 'Before tool' }],
    },
    {
      status: 'completed',
      text: 'Website answer',
      reasoning: [{ modelTurnIndex: 1, text: 'After tool' }],
    },
  ]);
  // One logical generation per request in this fixture, not a promise about every Engine's HTTP count.
  expect(provider.requests).toHaveLength(2);
  const second = JSON.stringify(provider.requests[1]);
  expect(second).toContain('Introduce yourself');
  expect(second).toContain('Website answer');
  expect(second).toContain('Where can I see projects?');
  expect(second).toContain('caller-provided-temporary-transcript');
  expect(second).toContain('Explain the personal site.');
  expect(second).not.toContain('Before tool');
  expect(second).not.toContain('After tool');
  expect(second).not.toContain('tool_calls');
  expect(provider.requests[1]).toMatchObject({
    messages: [{ role: 'system' }, { role: 'user' }, { role: 'user' }],
  });
  // This checks table creation as well as data: no Session/Journal provisioning can hide empty writes.
  expect(databaseSnapshot(join(root, 'website', 'agent.sqlite'))).toEqual(before);
  expect(
    value(await backend.sessions.listSessions({ agentId: 'website', status: 'active' })).records
  ).toHaveLength(0);
  controller.clear();
  expect(controller.getSnapshot().turns).toEqual([]);
  const freshPage = new TemporaryConversationController(ports.temporaryConversations);
  expect(freshPage.getSnapshot().turns).toEqual([]);
  await freshPage.dispose();
});
