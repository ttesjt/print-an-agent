import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { MemorySessionAdapter, SqliteSessionAdapter } from '@ta-agent/base-local-adapters';
import { DEFAULT_SESSION_COMPACTION_POLICY, parseTurnId } from '@ta-agent/base-session';
import { createProviderAgentAPI } from '../../src/index.js';
import { seedCompactionSession } from '../support/compaction-fixture.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../support/compaction-token-counter.js';
import { compactionProviderServer } from '../support/compaction-provider-server.js';

it.each(['memory', 'sqlite'])(
  'qualifies multi-pass compaction through real Pi and %s publication',
  async (kind) => {
    const directory = mkdtempSync(join(tmpdir(), 'compaction-provider-'));
    const databasePath = join(directory, 'agent.sqlite');
    const session =
      kind === 'sqlite' ? new SqliteSessionAdapter({ databasePath }) : new MemorySessionAdapter();
    const server = await compactionProviderServer([{ text: 'x'.repeat(45) }, { text: 'short' }]);
    try {
      const agent = createProviderAgentAPI({
        identity: { id: 'provider-compactor' },
        session,
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        sessionCompactionPolicy: {
          ...DEFAULT_SESSION_COMPACTION_POLICY,
          maxContextTokens: 30,
          target: { maxTokens: 30 },
        },
        provider: {
          config: {
            kind: 'openai-compatible',
            reference: { provider: 'fixture', model: 'fixture', baseUrl: server.baseUrl },
            contextWindowTokens: 8192,
            maxOutputTokens: 1024,
            supportsReasoning: false,
            compatibility: { supportsDeveloperRole: false },
          },
        },
      });
      const reference = await seedCompactionSession(session, agent.identity);
      const commit = vi.spyOn(session, 'commitCompaction');
      await expect(agent.compactSession({ sessionId: reference.sessionId })).resolves.toMatchObject(
        { status: 'compacted', revision: 1, throughTurnId: 'turn-2' }
      );
      expect(server.requests).toHaveLength(2);
      expect(JSON.stringify(server.requests[1])).toContain('18 tokens');
      expect(JSON.stringify(server.requests[1])).toContain('x'.repeat(45));
      expect(commit).toHaveBeenCalledTimes(1);
      const reopened = kind === 'sqlite' ? new SqliteSessionAdapter({ databasePath }) : session;
      {
        const context = await reopened.loadContext({
          ...reference,
          beforeTurnId: parseTurnId('turn-4'),
        });
        expect(context.messages.map((message) => message.text)).toEqual([
          'short',
          'original-fact-3',
          'answer-3',
        ]);
        expect((await reopened.inspect(reference))?.turns).toHaveLength(4);
      }
    } finally {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
);

it('recovers from a real Pi generation safety limit without reusing partial output', async () => {
  const server = await compactionProviderServer([{ text: 'x'.repeat(32) }, { text: 'ok' }]);
  try {
    const agent = createProviderAgentAPI({
      identity: { id: 'provider-generation-limit' },
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      sessionCompactionPolicy: {
        ...DEFAULT_SESSION_COMPACTION_POLICY,
        maxContextTokens: 4,
        target: { maxTokens: 4 },
        maxGenerationCharacters: 16,
      },
      provider: {
        config: {
          kind: 'openai-compatible',
          reference: { provider: 'fixture', model: 'fixture', baseUrl: server.baseUrl },
          contextWindowTokens: 8192,
          maxOutputTokens: 1024,
          supportsReasoning: false,
          compatibility: { supportsDeveloperRole: false },
        },
      },
    });
    const reference = await seedCompactionSession(agent.agent.resources.session, agent.identity);
    await agent.compactSession({ sessionId: reference.sessionId });
    expect(server.requests).toHaveLength(2);
    expect(JSON.stringify(server.requests[1])).toContain('generation-limit');
    expect(JSON.stringify(server.requests[1])).not.toContain('x'.repeat(32));
    expect((await agent.agent.resources.session.readCompaction(reference))?.context.text).toBe(
      'ok'
    );
  } finally {
    await server.close();
  }
});

it('does not publish a length-truncated Pi response even when it fits the token target', async () => {
  const server = await compactionProviderServer([
    { text: 'partial', finishReason: 'length' },
    { text: 'valid' },
  ]);
  try {
    const agent = createProviderAgentAPI({
      identity: { id: 'provider-truncated' },
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      provider: {
        config: {
          kind: 'openai-compatible',
          reference: { provider: 'fixture', model: 'fixture', baseUrl: server.baseUrl },
          contextWindowTokens: 8192,
          maxOutputTokens: 1024,
          supportsReasoning: false,
          compatibility: { supportsDeveloperRole: false },
        },
      },
    });
    const reference = await seedCompactionSession(agent.agent.resources.session, agent.identity);
    await agent.compactSession({ sessionId: reference.sessionId });
    expect(server.requests).toHaveLength(2);
    expect(JSON.stringify(server.requests[1])).not.toContain('partial');
    expect((await agent.agent.resources.session.readCompaction(reference))?.context.text).toBe(
      'valid'
    );
  } finally {
    await server.close();
  }
});
