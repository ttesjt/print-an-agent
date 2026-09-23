import { sessionWrite } from '../support/session-write.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseAgentId } from '@ta-agent/base-identity';
import { parseSessionId, parseTurnId, parseSessionBranchId } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import { MemorySessionAdapter, SqliteSessionAdapter } from '../../src/index.js';
import { assistantMessage, userMessage } from '../support/session-port-contract.js';

function harness(kind: 'memory' | 'sqlite') {
  const directory = mkdtempSync(join(tmpdir(), 'session-presentation-'));
  const databasePath = join(directory, 'agent.sqlite');
  const options = { databasePath, tablePrefix: 'consumer_' };
  const adapter =
    kind === 'memory' ? new MemorySessionAdapter() : new SqliteSessionAdapter(options);
  return {
    adapter,
    databasePath,
    reopen: () => (kind === 'memory' ? adapter : new SqliteSessionAdapter(options)),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

describe.each(['memory', 'sqlite'] as const)('%s Session presentation contract', (kind) => {
  it('commits readable presentation, reloads it separately, and never projects it into model context', async () => {
    const h = harness(kind);
    try {
      const adapter = h.adapter;
      const session = await adapter.resolve({
        agentId: parseAgentId('owner'),
      });
      const turnId = parseTurnId('first');
      await sessionWrite(
        adapter,
        { ...session, turnId, userMessage: userMessage('hello', 1) },
        (input) => adapter.beginTurn(input)
      );
      const firstBlock = { modelTurnIndex: 1, text: 'PRIVATE_PRESENTATION' };
      const presentation = {
        reasoningBlocks: [firstBlock, { modelTurnIndex: 3, text: 'after tool' }],
      };
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId,
          assistantMessage: assistantMessage('answer', 2),
          presentation,
        },
        (input) => adapter.completeTurnWithPresentation(input)
      );
      firstBlock.text = 'mutated';
      presentation.reasoningBlocks.reverse();
      const reopened = h.reopen();
      const record = await reopened.readTurnPresentation({ ...session, turnId });
      expect(record).toEqual({
        agentId: session.agentId,
        sessionId: session.sessionId,
        branchId: session.branchId,
        turnId,
        presentation: {
          reasoningBlocks: [
            { modelTurnIndex: 1, text: 'PRIVATE_PRESENTATION' },
            { modelTurnIndex: 3, text: 'after tool' },
          ],
        },
      });
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record?.presentation)).toBe(true);
      expect(Object.isFrozen(record?.presentation.reasoningBlocks)).toBe(true);
      expect(Object.isFrozen(record?.presentation.reasoningBlocks[0])).toBe(true);
      expect(JSON.stringify(await reopened.inspect(session))).not.toContain('PRIVATE_PRESENTATION');
      expect(JSON.stringify(await reopened.listSessionTurns(session))).not.toContain(
        'PRIVATE_PRESENTATION'
      );
      const resolved = await reopened.resolve({
        agentId: session.agentId,
        sessionId: session.sessionId,
      });
      const next = parseTurnId('next');
      await sessionWrite(
        reopened,
        { ...resolved, turnId: next, userMessage: userMessage('next', 3) },
        (input) => reopened.beginTurn(input)
      );
      expect(
        JSON.stringify(await reopened.loadHistory({ ...session, beforeTurnId: next }))
      ).not.toContain('PRIVATE_PRESENTATION');
      await sessionWrite(
        reopened,
        {
          ...session,
          expectedRevision: 0,
          throughTurnId: turnId,
          context: { role: 'context', text: 'summary', timestamp: 3 },
        },
        (input) => reopened.commitCompaction(input)
      );
      expect(
        JSON.stringify(await reopened.loadContext({ ...session, beforeTurnId: next }))
      ).not.toContain('PRIVATE_PRESENTATION');
      await sessionWrite(
        reopened,
        { ...session, turnId: next, failureCode: 'CANCELLED' },
        (input) => reopened.failTurn(input)
      );
      await sessionWrite(
        reopened,
        {
          ...session,
          command: {
            operation: 'rewind',
            expectedRevision: (await reopened.inspect(session))?.navigation.revision ?? -1,
            throughTurnId: turnId,
            newBranchId: parseSessionBranchId('fork'),
          },
        },
        (input) => reopened.applyNavigation(input)
      );
      expect(await reopened.readTurnPresentation({ ...session, turnId })).toEqual(record);
      expect(
        await reopened.readTurnPresentation({ ...session, turnId, agentId: parseAgentId('other') })
      ).toBeUndefined();
      expect(
        await reopened.readTurnPresentation({
          ...session,
          turnId,
          sessionId: parseSessionId('other'),
        })
      ).toBeUndefined();
      expect(await reopened.readTurnPresentation({ ...session, turnId: next })).toBeUndefined();
    } finally {
      h.dispose();
    }
  });

  it('rejects invalid presentation before changing turn state and forbids terminal rewrites', async () => {
    const h = harness(kind);
    try {
      const session = await h.adapter.resolve({ agentId: parseAgentId('owner') });
      const turnId = parseTurnId('first');
      await sessionWrite(
        h.adapter,
        { ...session, turnId, userMessage: userMessage('hello', 1) },
        (input) => h.adapter.beginTurn(input)
      );
      const request = {
        ...session,
        turnId,
        assistantMessage: assistantMessage('answer', 2),
        presentation: { reasoningBlocks: [] },
      };
      await expect(
        sessionWrite(h.adapter, request, (input) => h.adapter.completeTurnWithPresentation(input))
      ).rejects.toMatchObject({
        code: 'SESSION_PRESENTATION_INVALID',
      });
      expect((await h.adapter.inspect(session))?.turns[0]?.status).toBe('active');
      expect(await h.adapter.readTurnPresentation(request)).toBeUndefined();
      await sessionWrite(h.adapter, request, (input) => h.adapter.completeTurn(input));
      expect(await h.adapter.readTurnPresentation(request)).toBeUndefined();
      await expect(
        sessionWrite(
          h.adapter,
          {
            ...request,
            presentation: { reasoningBlocks: [{ modelTurnIndex: 1, text: 'late' }] },
          },
          (input) => h.adapter.completeTurnWithPresentation(input)
        )
      ).rejects.toMatchObject({ code: 'TURN_STATE_INVALID' });
    } finally {
      h.dispose();
    }
  });
});

describe('SQLite presentation integrity', () => {
  it('rolls back the presentation and answer when the branch commit fails, then rejects corrupt display data', async () => {
    const h = harness('sqlite');
    const database = new DatabaseSync(h.databasePath);
    try {
      const session = await h.adapter.resolve({ agentId: parseAgentId('owner') });
      const turnId = parseTurnId('first');
      await sessionWrite(
        h.adapter,
        { ...session, turnId, userMessage: userMessage('hello', 1) },
        (input) => h.adapter.beginTurn(input)
      );
      database.exec(
        "CREATE TRIGGER reject_branch BEFORE UPDATE ON consumer_session_branches BEGIN SELECT RAISE(ABORT, 'fixture'); END;"
      );
      const request = {
        ...session,
        turnId,
        assistantMessage: assistantMessage('answer', 2),
        presentation: { reasoningBlocks: [{ modelTurnIndex: 1, text: 'reason' }] },
      };
      await expect(
        sessionWrite(h.adapter, request, (input) => h.adapter.completeTurnWithPresentation(input))
      ).rejects.toMatchObject({
        code: 'SESSION_STORAGE_FAILED',
      });
      expect((await h.reopen().inspect(session))?.turns[0]?.status).toBe('active');
      expect(await h.reopen().readTurnPresentation(request)).toBeUndefined();
      expect(
        database.prepare('SELECT assistant_message, presentation FROM consumer_session_turns').get()
      ).toMatchObject({ assistant_message: null, presentation: null });
      database.exec('DROP TRIGGER reject_branch');
      await sessionWrite(h.adapter, request, (input) =>
        h.adapter.completeTurnWithPresentation(input)
      );
      database
        .prepare('UPDATE consumer_session_turns SET presentation = ?')
        .run('{"reasoning":"x","signature":"opaque"}');
      await expect(h.reopen().readTurnPresentation(request)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });
      // Display corruption must not become model input or invalidate unrelated history reads.
      expect((await h.reopen().inspect(session))?.turns[0]?.status).toBe('completed');
    } finally {
      database.close();
      h.dispose();
    }
  });

  it('rejects an incomplete current schema without silently adding presentation storage', async () => {
    const h = harness('sqlite');
    try {
      const database = new DatabaseSync(h.databasePath);
      try {
        database.exec('ALTER TABLE consumer_session_turns DROP COLUMN presentation');
      } finally {
        database.close();
      }
      await expect(Promise.resolve().then(h.reopen)).rejects.toMatchObject({
        code: 'SESSION_SCHEMA_INVALID',
      });
    } finally {
      h.dispose();
    }
  });
});
