import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryOutputSink } from '@ta-agent/base-local-adapters';
import { AgentModelError } from '@ta-agent/base-model';
import { createStandaloneAgent } from '@ta-agent/base-standalone-agent';
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
    const firstAgent = createStandaloneAgent(config, runtimeOptions);
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
    const reconstructedAgent = createStandaloneAgent(config, runtimeOptions);
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
    expect(JSON.stringify(reconstructedAgent.inspectProvider())).not.toContain(
      'persist this request'
    );

    const database = new DatabaseSync(config.persistence.databasePath);
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    database.close();
    expect(tables).toEqual([
      'consumer_branches',
      'consumer_compactions',
      'consumer_request_meta',
      'consumer_requests',
      'consumer_session_meta',
      'consumer_sessions',
      'consumer_turns',
    ]);
  });

  it('normalizes an ordinary provider failure and fails the OutputSink', async () => {
    const provider = await startLoopbackProvider([{ status: 'failure', statusCode: 503 }]);
    providers.push(provider);
    const sink = new MemoryOutputSink();
    const agent = createStandaloneAgent(
      {
        schemaVersion: 1,
        identity: { id: 'failing-consumer' },
        provider: {
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
        persistence: { kind: 'memory' },
      },
      { readEnvironmentVariable: () => undefined }
    );

    await expect(agent.run({ message: 'fail safely', outputSink: sink })).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_PROVIDER_FAILED' })
    );
    expect(sink.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'MODEL_PROVIDER_FAILED' },
    });
  });
});
