import { sessionWrite } from '../support/session-write.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { describe, expect, it } from 'vitest';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionBranchId,
  parseTurnId,
  type AgentSessionErrorCode,
} from '@print-an-agent/base-session';
import { SqliteSessionAdapter } from '../../src/index.js';
import { defineSessionIdentityContract } from '../support/session-identity-contract.js';
import {
  assistantMessage,
  defineSessionPortContract,
  engineAssistantMessage,
  userMessage,
} from '../support/session-port-contract.js';

interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
  readonly dispose: () => void;
}

function createTemporaryDatabase(): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'ta-agent-session-'));
  return Object.freeze({
    directory,
    databasePath: join(directory, 'session.sqlite'),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  });
}

function createClock(): () => number {
  let current = 100;
  return () => ++current;
}

defineSessionIdentityContract('SqliteSessionAdapter', (createSessionId) => {
  const temporary = createTemporaryDatabase();
  return {
    adapter: new SqliteSessionAdapter({
      databasePath: temporary.databasePath,
      ...(createSessionId === undefined ? {} : { createSessionId }),
    }),
    dispose: temporary.dispose,
  };
});

function expectSessionError(action: () => unknown, code: AgentSessionErrorCode): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toEqual(expect.objectContaining<Partial<AgentSessionError>>({ code }));
}

defineSessionPortContract('SqliteSessionAdapter', () => {
  const temporary = createTemporaryDatabase();
  let sequence = 0;
  return {
    adapter: new SqliteSessionAdapter({
      databasePath: temporary.databasePath,
      createSessionId: () => `generated-session-${++sequence}`,
      clock: createClock(),
    }),
    dispose: temporary.dispose,
  };
});

describe('SqliteSessionAdapter durability', () => {
  it('reopens custom-prefixed storage without losing turns or compaction', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'migration-agent' });
      const first = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
        tablePrefix: 'custom_',
      });
      const session = await first.resolve({
        agentId: identity.id,
      });
      const completedId = parseTurnId('completed');
      await sessionWrite(
        first,
        {
          ...session,
          turnId: completedId,
          userMessage: userMessage('preserved', 1),
        },
        (input) => first.beginTurn(input)
      );
      await sessionWrite(
        first,
        {
          ...session,
          turnId: completedId,
          assistantMessage: assistantMessage('also preserved', 2),
        },
        (input) => first.completeTurn(input)
      );
      await sessionWrite(
        first,
        {
          ...session,
          expectedRevision: 0,
          throughTurnId: completedId,
          context: { role: 'context', text: 'preserved summary', timestamp: 3 },
        },
        (input) => first.commitCompaction(input)
      );

      const migrated = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        tablePrefix: 'custom_',
      });
      const page = await migrated.listSessions({ agentId: identity.id });
      expect(page.records).toMatchObject([
        {
          sessionId: 'conversation',
          createdAt: 101,
          updatedAt: 104,
          turnCount: 1,
        },
      ]);
      const database = new DatabaseSync(temporary.databasePath);
      const schema = database
        .prepare(`SELECT version FROM custom_session_schema WHERE component = 'session'`)
        .get() as { version: number };
      const indexNames = database
        .prepare('PRAGMA index_list(custom_sessions)')
        .all()
        .map((row) => (row as { name: string }).name);
      const queryPlan = database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT session_id
           FROM custom_sessions
           WHERE agent_id = ?
           ORDER BY updated_at DESC, session_id ASC
           LIMIT ?`
        )
        .all(identity.id, 10)
        .map((row) => (row as { detail: string }).detail)
        .join(' ');
      database.close();
      expect(schema.version).toBe(5);
      expect(indexNames).toContain('custom_sessions_activity_idx');
      expect(queryPlan).toContain('custom_sessions_activity_idx');
      const boundaryId = parseTurnId('boundary');
      await sessionWrite(
        migrated,
        {
          ...(await migrated.resolve({
            agentId: identity.id,
            sessionId: session.sessionId,
          })),
          turnId: boundaryId,
          userMessage: userMessage('next', 3),
        },
        (input) => migrated.beginTurn(input)
      );
      expect(await migrated.loadHistory({ ...session, beforeTurnId: boundaryId })).toEqual([
        userMessage('preserved', 1),
        assistantMessage('also preserved', 2),
      ]);
      expect(await migrated.readCompaction(session)).toMatchObject({
        branchId: DEFAULT_SESSION_BRANCH_ID,
        revision: 1,
        throughTurnId: completedId,
        context: { text: 'preserved summary' },
      });
    } finally {
      temporary.dispose();
    }
  });

  it('reopens a completed conversation and preserves stable history', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'durable-agent' });
      const firstAdapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const session = await firstAdapter.resolve({
        agentId: identity.id,
      });
      const firstTurnId = parseTurnId('turn-1');
      await sessionWrite(
        firstAdapter,
        {
          ...session,
          turnId: firstTurnId,
          userMessage: userMessage('one', 1),
        },
        (input) => firstAdapter.beginTurn(input)
      );
      await sessionWrite(
        firstAdapter,
        {
          ...session,
          turnId: firstTurnId,
          assistantMessage: engineAssistantMessage('first', 2),
        },
        (input) => firstAdapter.completeTurn(input)
      );

      const reopened = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const reopenedSession = await reopened.resolve({
        agentId: identity.id,
        sessionId: 'conversation',
      });
      const secondTurnId = parseTurnId('turn-2');
      await sessionWrite(
        reopened,
        {
          ...reopenedSession,
          turnId: secondTurnId,
          userMessage: userMessage('two', 3),
        },
        (input) => reopened.beginTurn(input)
      );

      expect(
        await reopened.loadHistory({ ...reopenedSession, beforeTurnId: secondTurnId })
      ).toEqual([userMessage('one', 1), engineAssistantMessage('first', 2)]);
      expect((await reopened.inspect(reopenedSession))?.turns.map((turn) => turn.status)).toEqual([
        'completed',
        'active',
      ]);
    } finally {
      temporary.dispose();
    }
  });

  it('rejects the former provider/model assistant-message shape under schema version 1', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'legacy-message-agent' });
      const adapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const session = await adapter.resolve({
        agentId: identity.id,
      });
      const turnId = parseTurnId('turn');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId,
          userMessage: userMessage('hello', 1),
        },
        (input) => adapter.beginTurn(input)
      );
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId,
          assistantMessage: assistantMessage('current', 2),
        },
        (input) => adapter.completeTurn(input)
      );
      const database = new DatabaseSync(temporary.databasePath);
      database
        .prepare('UPDATE agent_session_turns SET assistant_message = ? WHERE turn_id = ?')
        .run(
          JSON.stringify({
            schemaVersion: 1,
            role: 'assistant',
            text: 'legacy',
            provider: 'faux',
            model: 'faux-model',
            stopReason: 'stop',
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 2,
            },
            timestamp: 2,
          }),
          turnId
        );
      database.close();

      await expect(adapter.inspect(session)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });
    } finally {
      temporary.dispose();
    }
  });

  it('recovers only the explicitly identified interrupted turn', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'recovery-agent' });
      const firstAdapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      let session = await firstAdapter.resolve({
        agentId: identity.id,
      });
      const interruptedId = parseTurnId('interrupted');
      const untouchedId = parseTurnId('untouched');
      const baseId = parseTurnId('base');
      await sessionWrite(
        firstAdapter,
        {
          ...session,
          turnId: baseId,
          userMessage: userMessage('base', 1),
        },
        (input) => firstAdapter.beginTurn(input)
      );
      await sessionWrite(
        firstAdapter,
        {
          ...session,
          turnId: baseId,
          assistantMessage: assistantMessage('base answer', 2),
        },
        (input) => firstAdapter.completeTurn(input)
      );
      session = await firstAdapter.resolve({
        agentId: identity.id,
        sessionId: 'conversation',
      });
      const childBranchId = parseSessionBranchId('recovery-child');
      await sessionWrite(
        firstAdapter,
        {
          ...session,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: baseId,
            newBranchId: childBranchId,
            expectedRevision: session.navigationRevision,
          },
        },
        (input) => firstAdapter.applyNavigation(input)
      );
      session = await firstAdapter.resolve({
        agentId: identity.id,
        sessionId: 'conversation',
      });
      await sessionWrite(
        firstAdapter,
        {
          ...session,
          turnId: interruptedId,
          userMessage: userMessage('recover me', 1),
        },
        (input) => firstAdapter.beginTurn(input)
      );
      await sessionWrite(
        firstAdapter,
        {
          ...session,
          command: {
            operation: 'select',
            branchId: childBranchId,
            expectedRevision: session.navigationRevision,
          },
        },
        (input) => firstAdapter.applyNavigation(input)
      );
      session = await firstAdapter.resolve({
        agentId: identity.id,
        sessionId: 'conversation',
      });
      await sessionWrite(
        firstAdapter,
        {
          ...session,
          turnId: untouchedId,
          userMessage: userMessage('leave me', 2),
        },
        (input) => firstAdapter.beginTurn(input)
      );

      const reopened = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      await sessionWrite(
        reopened,
        {
          ...session,
          turnId: interruptedId,
          failureCode: 'PROCESS_INTERRUPTED',
        },
        (input) => reopened.failTurn(input)
      );

      expect((await reopened.inspect(session))?.turns).toMatchObject([
        { turnId: baseId, status: 'completed' },
        { turnId: interruptedId, status: 'failed', failureCode: 'PROCESS_INTERRUPTED' },
        { turnId: untouchedId, status: 'active' },
      ]);
    } finally {
      temporary.dispose();
    }
  });

  it('keeps the first terminal state across separate adapter instances', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'terminal-agent' });
      const first = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const second = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const session = await first.resolve({
        agentId: identity.id,
      });
      const turnId = parseTurnId('turn');
      await sessionWrite(
        first,
        {
          ...session,
          turnId,
          userMessage: userMessage('hello', 1),
        },
        (input) => first.beginTurn(input)
      );
      await sessionWrite(second, { ...session, turnId, failureCode: 'FIRST_FAILURE' }, (input) =>
        second.failTurn(input)
      );

      await expect(
        sessionWrite(
          first,
          {
            ...session,
            turnId,
            assistantMessage: assistantMessage('late', 2),
          },
          (input) => first.completeTurn(input)
        )
      ).rejects.toEqual(
        expect.objectContaining<Partial<AgentSessionError>>({ code: 'TURN_STATE_INVALID' })
      );
      expect((await first.inspect(session))?.turns[0]).toMatchObject({
        status: 'failed',
        failureCode: 'FIRST_FAILURE',
      });
    } finally {
      temporary.dispose();
    }
  });

  it('rejects future schemas, schema drift, and corrupt records with structured errors', async () => {
    const future = createTemporaryDatabase();
    const drift = createTemporaryDatabase();
    const missingIndex = createTemporaryDatabase();
    const corrupt = createTemporaryDatabase();
    try {
      new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: future.databasePath,
      });
      const futureDatabase = new DatabaseSync(future.databasePath);
      futureDatabase
        .prepare(
          `UPDATE agent_session_schema
           SET version = 6 WHERE component = 'session'`
        )
        .run();
      futureDatabase.close();
      expectSessionError(
        () =>
          new SqliteSessionAdapter({
            createSessionId: () => 'conversation',
            databasePath: future.databasePath,
          }),
        'SESSION_SCHEMA_UNSUPPORTED'
      );

      new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: drift.databasePath,
      });
      const driftDatabase = new DatabaseSync(drift.databasePath);
      driftDatabase.exec(
        'ALTER TABLE agent_session_turns RENAME COLUMN failure_code TO unexpected_code'
      );
      driftDatabase.close();
      expectSessionError(
        () =>
          new SqliteSessionAdapter({
            createSessionId: () => 'conversation',
            databasePath: drift.databasePath,
          }),
        'SESSION_SCHEMA_INVALID'
      );

      new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: missingIndex.databasePath,
      });
      const missingIndexDatabase = new DatabaseSync(missingIndex.databasePath);
      missingIndexDatabase.exec('DROP INDEX agent_sessions_activity_idx');
      missingIndexDatabase.close();
      expectSessionError(
        () =>
          new SqliteSessionAdapter({
            createSessionId: () => 'conversation',
            databasePath: missingIndex.databasePath,
          }),
        'SESSION_SCHEMA_INVALID'
      );

      const adapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: corrupt.databasePath,
        clock: createClock(),
      });
      const session = await adapter.resolve({
        agentId: defineAgentIdentity({ id: 'corrupt-agent' }).id,
      });
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: parseTurnId('turn'),
          userMessage: userMessage('hello', 1),
        },
        (input) => adapter.beginTurn(input)
      );
      const corruptDatabase = new DatabaseSync(corrupt.databasePath);
      corruptDatabase.prepare('UPDATE agent_session_turns SET user_message = ?').run('{bad json');
      corruptDatabase.close();

      await expect(adapter.inspect(session)).rejects.toEqual(
        expect.objectContaining<Partial<AgentSessionError>>({ code: 'SESSION_RECORD_INVALID' })
      );
    } finally {
      future.dispose();
      drift.dispose();
      missingIndex.dispose();
      corrupt.dispose();
    }
  });

  it('rejects a corrupt persisted compaction context', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const adapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const session = await adapter.resolve({
        agentId: defineAgentIdentity({ id: 'corrupt-compaction-agent' }).id,
      });
      const turnId = parseTurnId('turn');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId,
          userMessage: userMessage('hello', 1),
        },
        (input) => adapter.beginTurn(input)
      );
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId,
          assistantMessage: assistantMessage('answer', 2),
        },
        (input) => adapter.completeTurn(input)
      );
      await sessionWrite(
        adapter,
        {
          ...session,
          expectedRevision: 0,
          throughTurnId: turnId,
          context: { role: 'context', text: 'summary', timestamp: 3 },
        },
        (input) => adapter.commitCompaction(input)
      );

      const database = new DatabaseSync(temporary.databasePath);
      database.prepare('UPDATE agent_session_compactions SET context_message = ?').run('{bad json');
      database.close();

      await expect(adapter.readCompaction(session)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });
    } finally {
      temporary.dispose();
    }
  });

  it('rejects missing branches, turn cycles, invalid heads, and foreign compaction lineage', async () => {
    const missingBranch = createTemporaryDatabase();
    const turnCycle = createTemporaryDatabase();
    const invalidHead = createTemporaryDatabase();
    const invalidCompaction = createTemporaryDatabase();
    try {
      const missingAdapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: missingBranch.databasePath,
      });
      const missingSession = await missingAdapter.resolve({
        agentId: defineAgentIdentity({ id: 'missing-branch-agent' }).id,
      });
      const missingDatabase = new DatabaseSync(missingBranch.databasePath);
      missingDatabase.exec('PRAGMA foreign_keys = OFF');
      missingDatabase.prepare('DELETE FROM agent_session_branches').run();
      missingDatabase.close();
      await expect(missingAdapter.inspect(missingSession)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });

      const cycleAdapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: turnCycle.databasePath,
      });
      const cycleIdentity = defineAgentIdentity({ id: 'turn-cycle-agent' });
      let cycleSession = await cycleAdapter.resolve({
        agentId: cycleIdentity.id,
      });
      const firstId = parseTurnId('first');
      const secondId = parseTurnId('second');
      await sessionWrite(
        cycleAdapter,
        {
          ...cycleSession,
          turnId: firstId,
          userMessage: userMessage('first', 1),
        },
        (input) => cycleAdapter.beginTurn(input)
      );
      await sessionWrite(
        cycleAdapter,
        {
          ...cycleSession,
          turnId: firstId,
          assistantMessage: assistantMessage('first answer', 2),
        },
        (input) => cycleAdapter.completeTurn(input)
      );
      cycleSession = await cycleAdapter.resolve({
        agentId: cycleIdentity.id,
        sessionId: 'conversation',
      });
      await sessionWrite(
        cycleAdapter,
        {
          ...cycleSession,
          turnId: secondId,
          userMessage: userMessage('second', 3),
        },
        (input) => cycleAdapter.beginTurn(input)
      );
      await sessionWrite(
        cycleAdapter,
        {
          ...cycleSession,
          turnId: secondId,
          assistantMessage: assistantMessage('second answer', 4),
        },
        (input) => cycleAdapter.completeTurn(input)
      );
      const cycleDatabase = new DatabaseSync(turnCycle.databasePath);
      cycleDatabase
        .prepare(
          `UPDATE agent_session_turns
           SET parent_turn_id = ? WHERE turn_id = ?`
        )
        .run(secondId, firstId);
      cycleDatabase.close();
      await expect(cycleAdapter.inspect(cycleSession)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });

      const headAdapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: invalidHead.databasePath,
      });
      const headIdentity = defineAgentIdentity({ id: 'invalid-head-agent' });
      let headSession = await headAdapter.resolve({
        agentId: headIdentity.id,
      });
      const completedId = parseTurnId('completed');
      await sessionWrite(
        headAdapter,
        {
          ...headSession,
          turnId: completedId,
          userMessage: userMessage('completed', 1),
        },
        (input) => headAdapter.beginTurn(input)
      );
      await sessionWrite(
        headAdapter,
        {
          ...headSession,
          turnId: completedId,
          assistantMessage: assistantMessage('answer', 2),
        },
        (input) => headAdapter.completeTurn(input)
      );
      headSession = await headAdapter.resolve({
        agentId: headIdentity.id,
        sessionId: 'conversation',
      });
      const activeId = parseTurnId('active');
      await sessionWrite(
        headAdapter,
        {
          ...headSession,
          turnId: activeId,
          userMessage: userMessage('active', 3),
        },
        (input) => headAdapter.beginTurn(input)
      );
      const headDatabase = new DatabaseSync(invalidHead.databasePath);
      headDatabase.prepare('UPDATE agent_session_branches SET head_turn_id = ?').run(activeId);
      headDatabase.close();
      await expect(headAdapter.inspect(headSession)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });

      const compactionAdapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: invalidCompaction.databasePath,
      });
      const compactionIdentity = defineAgentIdentity({ id: 'invalid-lineage-agent' });
      let compactionSession = await compactionAdapter.resolve({
        agentId: compactionIdentity.id,
      });
      const compactionTurns = [parseTurnId('one'), parseTurnId('two')];
      for (const [index, turnId] of compactionTurns.entries()) {
        compactionSession = await compactionAdapter.resolve({
          agentId: compactionIdentity.id,
          sessionId: 'conversation',
        });
        await sessionWrite(
          compactionAdapter,
          {
            ...compactionSession,
            turnId,
            userMessage: userMessage(`u${index}`, index * 2 + 1),
          },
          (input) => compactionAdapter.beginTurn(input)
        );
        await sessionWrite(
          compactionAdapter,
          {
            ...compactionSession,
            turnId,
            assistantMessage: assistantMessage(`a${index}`, index * 2 + 2),
          },
          (input) => compactionAdapter.completeTurn(input)
        );
      }
      compactionSession = await compactionAdapter.resolve({
        agentId: compactionIdentity.id,
        sessionId: 'conversation',
      });
      await sessionWrite(
        compactionAdapter,
        {
          ...compactionSession,
          expectedRevision: 0,
          throughTurnId: compactionTurns[1]!,
          context: { role: 'context', text: 'summary', timestamp: 5 },
        },
        (input) => compactionAdapter.commitCompaction(input)
      );
      const childBranchId = parseSessionBranchId('early-child');
      await sessionWrite(
        compactionAdapter,
        {
          ...compactionSession,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: compactionTurns[0]!,
            newBranchId: childBranchId,
            expectedRevision: compactionSession.navigationRevision,
          },
        },
        (input) => compactionAdapter.applyNavigation(input)
      );
      const compactionDatabase = new DatabaseSync(invalidCompaction.databasePath);
      compactionDatabase
        .prepare(
          `INSERT INTO agent_session_compactions
            (agent_id, session_id, branch_id, revision, through_turn_id, context_message, created_at)
           SELECT agent_id, session_id, ?, 1, through_turn_id, context_message, created_at
           FROM agent_session_compactions WHERE branch_id = ?`
        )
        .run(childBranchId, DEFAULT_SESSION_BRANCH_ID);
      compactionDatabase.close();
      await expect(compactionAdapter.inspect(compactionSession)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });
    } finally {
      missingBranch.dispose();
      turnCycle.dispose();
      invalidHead.dispose();
      invalidCompaction.dispose();
    }
  });

  it('rejects a turn parent forged across sibling branches', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const adapter = new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
      });
      const identity = defineAgentIdentity({ id: 'cross-branch-parent-agent' });
      let session = await adapter.resolve({
        agentId: identity.id,
      });
      const rootTurnId = parseTurnId('root');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: rootTurnId,
          userMessage: userMessage('root', 1),
        },
        (input) => adapter.beginTurn(input)
      );
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: rootTurnId,
          assistantMessage: assistantMessage('root answer', 2),
        },
        (input) => adapter.completeTurn(input)
      );

      session = await adapter.resolve({
        agentId: identity.id,
        sessionId: 'conversation',
      });
      const firstBranchId = parseSessionBranchId('first-child');
      const secondBranchId = parseSessionBranchId('second-child');
      let navigation = await sessionWrite(
        adapter,
        {
          ...session,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: rootTurnId,
            newBranchId: firstBranchId,
            expectedRevision: session.navigationRevision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      navigation = await sessionWrite(
        adapter,
        {
          ...session,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: rootTurnId,
            newBranchId: secondBranchId,
            expectedRevision: navigation.navigation.revision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      await sessionWrite(
        adapter,
        {
          ...session,
          command: {
            operation: 'select',
            branchId: firstBranchId,
            expectedRevision: navigation.navigation.revision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );

      session = await adapter.resolve({
        agentId: identity.id,
        sessionId: 'conversation',
      });
      const firstChildTurnId = parseTurnId('first-child-turn');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: firstChildTurnId,
          userMessage: userMessage('first child', 3),
        },
        (input) => adapter.beginTurn(input)
      );
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: firstChildTurnId,
          assistantMessage: assistantMessage('first child answer', 4),
        },
        (input) => adapter.completeTurn(input)
      );
      session = await adapter.resolve({
        agentId: identity.id,
        sessionId: 'conversation',
      });
      await sessionWrite(
        adapter,
        {
          ...session,
          command: {
            operation: 'select',
            branchId: secondBranchId,
            expectedRevision: session.navigationRevision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      session = await adapter.resolve({
        agentId: identity.id,
        sessionId: 'conversation',
      });
      const secondChildTurnId = parseTurnId('second-child-turn');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: secondChildTurnId,
          userMessage: userMessage('second child', 5),
        },
        (input) => adapter.beginTurn(input)
      );

      const database = new DatabaseSync(temporary.databasePath);
      database
        .prepare(
          `UPDATE agent_session_turns
           SET parent_turn_id = ? WHERE turn_id = ?`
        )
        .run(firstChildTurnId, secondChildTurnId);
      database.close();

      await expect(adapter.inspect(session)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });
    } finally {
      temporary.dispose();
    }
  });

  it('rejects unsupported schemas without modifying their version', () => {
    const temporary = createTemporaryDatabase();
    try {
      new SqliteSessionAdapter({
        createSessionId: () => 'conversation',
        databasePath: temporary.databasePath,
      });
      const database = new DatabaseSync(temporary.databasePath);
      try {
        database.exec("UPDATE agent_session_schema SET version = 2 WHERE component = 'session'");
        expectSessionError(
          () =>
            new SqliteSessionAdapter({
              createSessionId: () => 'conversation',
              databasePath: temporary.databasePath,
            }),
          'SESSION_SCHEMA_UNSUPPORTED'
        );
        expect(
          database
            .prepare("SELECT version FROM agent_session_schema WHERE component = 'session'")
            .get()?.version
        ).toBe(2);
      } finally {
        database.close();
      }
    } finally {
      temporary.dispose();
    }
  });

  it('fails fast for invalid durable storage configuration', () => {
    expectSessionError(
      () =>
        new SqliteSessionAdapter({
          createSessionId: () => 'conversation',
          databasePath: ':memory:',
        }),
      'SESSION_PATH_INVALID'
    );
    expectSessionError(
      () =>
        new SqliteSessionAdapter({
          createSessionId: () => 'conversation',
          databasePath: join(tmpdir(), 'unused.sqlite'),
          busyTimeoutMilliseconds: 0,
        }),
      'SESSION_CONFIGURATION_INVALID'
    );
  });
});
