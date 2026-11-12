import { bootstrapTestAgent } from './support/owned-setup.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryOutputSink } from '@print-an-agent/base-local-adapters';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { createAgentAPI } from '@print-an-agent/base-composition';
import { createSharedSqliteStandaloneRuntimeService } from '@print-an-agent/base-standalone-agent';
import { afterEach, describe, expect, it } from 'vitest';
import { startLoopbackProvider, type LoopbackProvider } from './support/loopback-provider.js';

const providers: LoopbackProvider[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe('public standalone provider consumer', () => {
  it('streams through the ordinary provider boundary and replays after SQLite reconstruction', async () => {
    const provider = await startLoopbackProvider([
      { status: 'success', chunks: ['ordinary ', 'response'] },
    ]);
    providers.push(provider);
    const directory = await mkdtemp(join(tmpdir(), 'agent-base-consumer-'));
    temporaryDirectories.push(directory);
    const config = {
      schemaVersion: 1 as const,
      identity: { id: 'standalone-consumer' },
      provider: {
        config: {
          kind: 'openai-compatible' as const,
          reference: {
            provider: 'loopback',
            model: 'qualification-model',
            baseUrl: provider.baseUrl,
          },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
          supportsReasoning: false,
          compatibility: { supportsDeveloperRole: false },
        },
      },
      persistence: { kind: 'sqlite' as const, databasePath: join(directory, 'agent.sqlite') },
    };
    const runtimeOptions = {
      readEnvironmentVariable: () => undefined,
      sqlite: {
        tableNames: {
          session: {
            schema: 'consumer_session_meta',
            sessions: 'consumer_sessions',
            turns: 'consumer_turns',
            branches: 'consumer_branches',
            compactions: 'consumer_compactions',
          },
          requestJournal: {
            schema: 'consumer_request_meta',
            entries: 'consumer_requests',
          },
        },
      },
    } as const;
    const firstSink = new MemoryOutputSink();
    const firstAgent = createAgentAPI(await bootstrapTestAgent(config, runtimeOptions));
    const { sessionId } = await firstAgent.agent.resources.session.resolve({
      agentId: firstAgent.identity.id,
    });
    const request = {
      message: 'persist this request',
      sessionId,
      idempotencyKey: 'durable-request',
    };

    const first = await firstAgent.run({ ...request, outputSink: firstSink });
    const replaySink = new MemoryOutputSink();
    const reconstructedAgent = createAgentAPI(
      await createSharedSqliteStandaloneRuntimeService({
        ...runtimeOptions,
        databasePath: config.persistence.databasePath,
      }).open(config.identity.id)
    );
    const replay = await reconstructedAgent.run({ ...request, outputSink: replaySink });

    expect(first.message.text).toBe('ordinary response');
    expect(replay).toEqual(first);
    expect(provider.requests()).toHaveLength(1);
    expect(firstSink.inspect()).toMatchObject({
      status: 'closed',
      events: [
        { type: 'text-delta', delta: 'ordinary ' },
        { type: 'text-delta', delta: 'response' },
      ],
    });
    expect(replaySink.inspect()).toMatchObject({
      status: 'closed',
      response: { requestId: first.requestId },
    });

    const database = new DatabaseSync(config.persistence.databasePath);
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    database.close();
    expect(tables).toEqual([
      'agent_config_schema',
      'agent_configs',
      'agent_identities',
      'agent_identity_schema',
      'agent_managed_namespace_schema',
      'agent_managed_namespaces',
      'consumer_branches',
      'consumer_compactions',
      'consumer_request_meta',
      'consumer_requests',
      'consumer_session_meta',
      'consumer_sessions',
      'consumer_sessions_memory',
      'consumer_turns',
    ]);
  });

  it('normalizes an ordinary provider failure and fails the OutputSink', async () => {
    const provider = await startLoopbackProvider([{ status: 'failure', statusCode: 503 }]);
    providers.push(provider);
    const sink = new MemoryOutputSink();
    const agent = await bootstrapTestAgent(
      {
        schemaVersion: 1,
        identity: { id: 'failing-consumer' },
        provider: {
          config: {
            kind: 'openai-compatible',
            reference: {
              provider: 'loopback',
              model: 'qualification-model',
              baseUrl: provider.baseUrl,
            },
            contextWindowTokens: 8_192,
            maxOutputTokens: 1_024,
            supportsReasoning: false,
            compatibility: { supportsDeveloperRole: false },
          },
        },
        persistence: { kind: 'memory' },
      },
      { readEnvironmentVariable: () => undefined }
    );

    await expect(
      agent.invoke('foreground', { message: 'fail safely', outputSink: sink })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ModelInvocationError>>({ code: 'MODEL_PROVIDER_FAILED' })
    );
    expect(sink.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'MODEL_PROVIDER_FAILED' },
    });
  });
});
