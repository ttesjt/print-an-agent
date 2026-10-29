import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import {
  createStandaloneDirectoryManagementService,
  createStandaloneDirectorySetup,
} from '@ta-agent/base-standalone-agent';
import { loadAgentBaseCliRuntime } from '../../src/host-loaders.js';
import { withCliRuntime } from '../../src/owned-runtime.js';

it('embedded CLI uses the optional Profile policy and closes only after the real tool call joins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cli-runtime-memory-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const server = createServer((request, response) => {
    void (async () => {
      for await (const chunk of request) {
        void chunk;
      }
      calls++;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const packet = (delta: object, finishReason: string | null) =>
        `data: ${JSON.stringify({
          id: 'fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`;
      if (calls === 1) {
        response.write(
          packet(
            {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'save',
                  type: 'function',
                  function: {
                    name: 'apply_context_memory',
                    arguments: JSON.stringify({
                      expectedRevision: 1,
                      commands: [{ op: 'add', itemId: '', content: 'CLI remembered' }],
                    }),
                  },
                },
              ],
            },
            null
          )
        );
        response.end(packet({}, 'tool_calls') + 'data: [DONE]\n\n');
      } else
        response.end(
          packet({ role: 'assistant', content: 'saved' }, null) +
            packet({}, 'stop') +
            'data: [DONE]\n\n'
        );
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      })
  );
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing server address');
  const created = await createStandaloneDirectoryManagementService({ rootDirectory: root }).create({
    identity: { id: 'cli' },
    config: {
      provider: {
        config: {
          kind: 'openai-compatible',
          reference: {
            provider: 'fixture',
            model: 'fixture',
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
          },
          contextWindowTokens: 4096,
          maxOutputTokens: 256,
          supportsReasoning: false,
          compatibility: { supportsDeveloperRole: false },
        },
      },
    },
  });
  const memory = { storageNamespaceId: 'cli-test', context: { runtime: { writable: true } } };
  const runtime = await loadAgentBaseCliRuntime(
    { kind: 'directory', rootDirectory: root, agentId: 'cli' },
    {},
    memory
  );
  let sessionId: string | undefined;
  let output = '';
  await withCliRuntime(runtime, (owned) =>
    owned.run(
      { message: 'remember' },
      {
        signal: new AbortController().signal,
        sessionOpened: (id) => {
          sessionId = id;
          return Promise.resolve();
        },
        writeTextDelta: (text) => {
          output += text;
          return Promise.resolve();
        },
      }
    )
  );
  expect(output).toBe('saved');
  expect(calls).toBe(2);
  const setup = createStandaloneDirectorySetup(
    { rootDirectory: root, readEnvironmentVariable: () => undefined },
    memory
  );
  onTestFinished(() => setup.close());
  const namespace = await setup.definition.namespace.port.resolve(
    created.authority.identity.identity.id
  );
  if (namespace === undefined || sessionId === undefined) throw new Error('Missing Session');
  const ports = await setup.definition.sessionNavigation.createPorts(namespace);
  const sessions = await setup.definition.sessionManagement.createPorts(namespace);
  const record = (await sessions.session.listSessions({ agentId: namespace.agentId })).records.find(
    (s) => s.sessionId === sessionId
  );
  if (record === undefined) throw new Error('Missing Session record');
  const snapshot = await ports.session.inspect({
    agentId: namespace.agentId,
    sessionId: record.sessionId,
  });
  const turn = snapshot?.turns[0];
  if (snapshot === undefined || turn === undefined) throw new Error('Missing Turn');
  const checkpoint = await (
    await setup.sessionContextMemory!.resolve('cli')
  ).readCheckpoint(snapshot, turn.turnId);
  expect(checkpoint?.final.revision).toBe(2);
});
