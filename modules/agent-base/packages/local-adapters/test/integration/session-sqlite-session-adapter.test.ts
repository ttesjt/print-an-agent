import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionBranchId,
  parseTurnId,
  type AgentSessionErrorCode,
} from '@ta-agent/base-session';
import { SqliteSessionAdapter } from '../../src/index.js';
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

function downgradeToSchemaVersion2(databasePath: string, tablePrefix = 'agent_'): void {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;

    CREATE TABLE sessions_v2 (
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      next_turn_sequence INTEGER NOT NULL DEFAULT 0 CHECK (next_turn_sequence >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      PRIMARY KEY (agent_id, session_id)
    ) STRICT;
    INSERT INTO sessions_v2
      SELECT agent_id, session_id, next_turn_sequence, created_at
      FROM ${tablePrefix}sessions;

    CREATE TABLE turns_v2 (
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      turn_sequence INTEGER NOT NULL CHECK (turn_sequence >= 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed')),
      user_message TEXT NOT NULL,
      assistant_message TEXT,
      failure_code TEXT,
      started_at INTEGER NOT NULL CHECK (started_at >= 0),
      finished_at INTEGER CHECK (finished_at >= 0),
      PRIMARY KEY (agent_id, session_id, turn_id),
      UNIQUE (agent_id, session_id, turn_sequence),
      FOREIGN KEY (agent_id, session_id)
        REFERENCES sessions_v2 (agent_id, session_id)
        ON DELETE CASCADE,
      CHECK (
        (status = 'active' AND assistant_message IS NULL AND failure_code IS NULL AND finished_at IS NULL)
        OR
        (status = 'completed' AND assistant_message IS NOT NULL AND failure_code IS NULL AND finished_at IS NOT NULL)
        OR
        (status = 'failed' AND assistant_message IS NULL AND failure_code IS NOT NULL AND finished_at IS NOT NULL)
      )
    ) STRICT;
    INSERT INTO turns_v2
      SELECT agent_id, session_id, turn_id, turn_sequence, status, user_message,
             assistant_message, failure_code, started_at, finished_at
      FROM ${tablePrefix}session_turns;

    CREATE TABLE compactions_v2 (
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      through_turn_id TEXT NOT NULL,
      context_message TEXT NOT NULL,
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      PRIMARY KEY (agent_id, session_id),
      FOREIGN KEY (agent_id, session_id)
        REFERENCES sessions_v2 (agent_id, session_id)
        ON DELETE CASCADE,
      FOREIGN KEY (agent_id, session_id, through_turn_id)
        REFERENCES turns_v2 (agent_id, session_id, turn_id)
    ) STRICT;
    INSERT INTO compactions_v2
      SELECT agent_id, session_id, revision, through_turn_id, context_message, created_at
      FROM ${tablePrefix}session_compactions;

    DROP TABLE ${tablePrefix}session_compactions;
    DROP TABLE ${tablePrefix}session_branches;
    DROP TABLE ${tablePrefix}session_turns;
    DROP TABLE ${tablePrefix}sessions;
    ALTER TABLE sessions_v2 RENAME TO ${tablePrefix}sessions;
    ALTER TABLE turns_v2 RENAME TO ${tablePrefix}session_turns;
    ALTER TABLE compactions_v2 RENAME TO ${tablePrefix}session_compactions;
    UPDATE ${tablePrefix}session_schema
      SET version = 2 WHERE component = 'session';
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  database.close();
}

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
  return {
    adapter: new SqliteSessionAdapter({
      databasePath: temporary.databasePath,
      createSessionId: () => 'generated-session',
      clock: createClock(),
    }),
    dispose: temporary.dispose,
  };
});

describe('SqliteSessionAdapter durability', () => {
  it('migrates custom-prefixed schema version 2 without losing turns or compaction', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'migration-agent' });
      const first = new SqliteSessionAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
        tablePrefix: 'custom_',
      });
      const session = await first.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const completedId = parseTurnId('completed');
      await first.beginTurn({
        ...session,
        turnId: completedId,
        userMessage: userMessage('preserved', 1),
      });
      await first.completeTurn({
        ...session,
        turnId: completedId,
        assistantMessage: assistantMessage('also preserved', 2),
      });
      await first.commitCompaction({
        ...session,
        expectedRevision: 0,
        throughTurnId: completedId,
        context: { role: 'context', text: 'preserved summary', timestamp: 3 },
      });
      downgradeToSchemaVersion2(temporary.databasePath, 'custom_');

      const migrated = new SqliteSessionAdapter({
        databasePath: temporary.databasePath,
        tablePrefix: 'custom_',
      });
      const boundaryId = parseTurnId('boundary');
      await migrated.beginTurn({
        ...session,
        turnId: boundaryId,
        userMessage: userMessage('next', 3),
      });
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
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const session = await firstAdapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const firstTurnId = parseTurnId('turn-1');
      await firstAdapter.beginTurn({
        ...session,
        turnId: firstTurnId,
        userMessage: userMessage('one', 1),
      });
      await firstAdapter.completeTurn({
        ...session,
        turnId: firstTurnId,
        assistantMessage: engineAssistantMessage('first', 2),
      });

      const reopened = new SqliteSessionAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const reopenedSession = await reopened.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const secondTurnId = parseTurnId('turn-2');
      await reopened.beginTurn({
        ...reopenedSession,
        turnId: secondTurnId,
        userMessage: userMessage('two', 3),
      });

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
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const session = await adapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const turnId = parseTurnId('turn');
      await adapter.beginTurn({
        ...session,
        turnId,
        userMessage: userMessage('hello', 1),
      });
      await adapter.completeTurn({
        ...session,
        turnId,
        assistantMessage: assistantMessage('current', 2),
      });
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
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      let session = await firstAdapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const interruptedId = parseTurnId('interrupted');
      const untouchedId = parseTurnId('untouched');
      const baseId = parseTurnId('base');
      await firstAdapter.beginTurn({
        ...session,
        turnId: baseId,
        userMessage: userMessage('base', 1),
      });
      await firstAdapter.completeTurn({
        ...session,
        turnId: baseId,
        assistantMessage: assistantMessage('base answer', 2),
      });
      session = await firstAdapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const childBranchId = parseSessionBranchId('recovery-child');
      await firstAdapter.applyNavigation({
        ...session,
        command: {
          operation: 'fork',
          sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
          throughTurnId: baseId,
          newBranchId: childBranchId,
          expectedRevision: session.navigationRevision,
        },
      });
      session = await firstAdapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      await firstAdapter.beginTurn({
        ...session,
        turnId: interruptedId,
        userMessage: userMessage('recover me', 1),
      });
      await firstAdapter.applyNavigation({
        ...session,
        command: {
          operation: 'select',
          branchId: childBranchId,
          expectedRevision: session.navigationRevision,
        },
      });
      session = await firstAdapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      await firstAdapter.beginTurn({
        ...session,
        turnId: untouchedId,
        userMessage: userMessage('leave me', 2),
      });

      const reopened = new SqliteSessionAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      await reopened.failTurn({
        ...session,
        turnId: interruptedId,
        failureCode: 'PROCESS_INTERRUPTED',
      });

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
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const second = new SqliteSessionAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const session = await first.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const turnId = parseTurnId('turn');
      await first.beginTurn({
        ...session,
        turnId,
        userMessage: userMessage('hello', 1),
      });
      await second.failTurn({ ...session, turnId, failureCode: 'FIRST_FAILURE' });

      await expect(
        first.completeTurn({
          ...session,
          turnId,
          assistantMessage: assistantMessage('late', 2),
        })
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
    const corrupt = createTemporaryDatabase();
    try {
      new SqliteSessionAdapter({ databasePath: future.databasePath });
      const futureDatabase = new DatabaseSync(future.databasePath);
      futureDatabase
        .prepare(
          `UPDATE agent_session_schema
           SET version = 4 WHERE component = 'session'`
        )
        .run();
      futureDatabase.close();
      expectSessionError(
        () => new SqliteSessionAdapter({ databasePath: future.databasePath }),
        'SESSION_SCHEMA_UNSUPPORTED'
      );

      new SqliteSessionAdapter({ databasePath: drift.databasePath });
      const driftDatabase = new DatabaseSync(drift.databasePath);
      driftDatabase.exec(
        'ALTER TABLE agent_session_turns RENAME COLUMN failure_code TO unexpected_code'
      );
      driftDatabase.close();
      expectSessionError(
        () => new SqliteSessionAdapter({ databasePath: drift.databasePath }),
        'SESSION_SCHEMA_INVALID'
      );

      const adapter = new SqliteSessionAdapter({
        databasePath: corrupt.databasePath,
        clock: createClock(),
      });
      const session = await adapter.resolve({
        agentId: defineAgentIdentity({ id: 'corrupt-agent' }).id,
        requestedSessionId: 'conversation',
      });
      await adapter.beginTurn({
        ...session,
        turnId: parseTurnId('turn'),
        userMessage: userMessage('hello', 1),
      });
      const corruptDatabase = new DatabaseSync(corrupt.databasePath);
      corruptDatabase.prepare('UPDATE agent_session_turns SET user_message = ?').run('{bad json');
      corruptDatabase.close();

      await expect(adapter.inspect(session)).rejects.toEqual(
        expect.objectContaining<Partial<AgentSessionError>>({ code: 'SESSION_RECORD_INVALID' })
      );
    } finally {
      future.dispose();
      drift.dispose();
      corrupt.dispose();
    }
  });

  it('rejects a corrupt persisted compaction context', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const adapter = new SqliteSessionAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const session = await adapter.resolve({
        agentId: defineAgentIdentity({ id: 'corrupt-compaction-agent' }).id,
        requestedSessionId: 'conversation',
      });
      const turnId = parseTurnId('turn');
      await adapter.beginTurn({
        ...session,
        turnId,
        userMessage: userMessage('hello', 1),
      });
      await adapter.completeTurn({
        ...session,
        turnId,
        assistantMessage: assistantMessage('answer', 2),
      });
      await adapter.commitCompaction({
        ...session,
        expectedRevision: 0,
        throughTurnId: turnId,
        context: { role: 'context', text: 'summary', timestamp: 3 },
      });

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
      const missingAdapter = new SqliteSessionAdapter({ databasePath: missingBranch.databasePath });
      const missingSession = await missingAdapter.resolve({
        agentId: defineAgentIdentity({ id: 'missing-branch-agent' }).id,
        requestedSessionId: 'conversation',
      });
      const missingDatabase = new DatabaseSync(missingBranch.databasePath);
      missingDatabase.exec('PRAGMA foreign_keys = OFF');
      missingDatabase.prepare('DELETE FROM agent_session_branches').run();
      missingDatabase.close();
      await expect(missingAdapter.inspect(missingSession)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });

      const cycleAdapter = new SqliteSessionAdapter({ databasePath: turnCycle.databasePath });
      const cycleIdentity = defineAgentIdentity({ id: 'turn-cycle-agent' });
      let cycleSession = await cycleAdapter.resolve({
        agentId: cycleIdentity.id,
        requestedSessionId: 'conversation',
      });
      const firstId = parseTurnId('first');
      const secondId = parseTurnId('second');
      await cycleAdapter.beginTurn({
        ...cycleSession,
        turnId: firstId,
        userMessage: userMessage('first', 1),
      });
      await cycleAdapter.completeTurn({
        ...cycleSession,
        turnId: firstId,
        assistantMessage: assistantMessage('first answer', 2),
      });
      cycleSession = await cycleAdapter.resolve({
        agentId: cycleIdentity.id,
        requestedSessionId: 'conversation',
      });
      await cycleAdapter.beginTurn({
        ...cycleSession,
        turnId: secondId,
        userMessage: userMessage('second', 3),
      });
      await cycleAdapter.completeTurn({
        ...cycleSession,
        turnId: secondId,
        assistantMessage: assistantMessage('second answer', 4),
      });
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

      const headAdapter = new SqliteSessionAdapter({ databasePath: invalidHead.databasePath });
      const headIdentity = defineAgentIdentity({ id: 'invalid-head-agent' });
      let headSession = await headAdapter.resolve({
        agentId: headIdentity.id,
        requestedSessionId: 'conversation',
      });
      const completedId = parseTurnId('completed');
      await headAdapter.beginTurn({
        ...headSession,
        turnId: completedId,
        userMessage: userMessage('completed', 1),
      });
      await headAdapter.completeTurn({
        ...headSession,
        turnId: completedId,
        assistantMessage: assistantMessage('answer', 2),
      });
      headSession = await headAdapter.resolve({
        agentId: headIdentity.id,
        requestedSessionId: 'conversation',
      });
      const activeId = parseTurnId('active');
      await headAdapter.beginTurn({
        ...headSession,
        turnId: activeId,
        userMessage: userMessage('active', 3),
      });
      const headDatabase = new DatabaseSync(invalidHead.databasePath);
      headDatabase.prepare('UPDATE agent_session_branches SET head_turn_id = ?').run(activeId);
      headDatabase.close();
      await expect(headAdapter.inspect(headSession)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });

      const compactionAdapter = new SqliteSessionAdapter({
        databasePath: invalidCompaction.databasePath,
      });
      const compactionIdentity = defineAgentIdentity({ id: 'invalid-lineage-agent' });
      let compactionSession = await compactionAdapter.resolve({
        agentId: compactionIdentity.id,
        requestedSessionId: 'conversation',
      });
      const compactionTurns = [parseTurnId('one'), parseTurnId('two')];
      for (const [index, turnId] of compactionTurns.entries()) {
        compactionSession = await compactionAdapter.resolve({
          agentId: compactionIdentity.id,
          requestedSessionId: 'conversation',
        });
        await compactionAdapter.beginTurn({
          ...compactionSession,
          turnId,
          userMessage: userMessage(`u${index}`, index * 2 + 1),
        });
        await compactionAdapter.completeTurn({
          ...compactionSession,
          turnId,
          assistantMessage: assistantMessage(`a${index}`, index * 2 + 2),
        });
      }
      compactionSession = await compactionAdapter.resolve({
        agentId: compactionIdentity.id,
        requestedSessionId: 'conversation',
      });
      await compactionAdapter.commitCompaction({
        ...compactionSession,
        expectedRevision: 0,
        throughTurnId: compactionTurns[1]!,
        context: { role: 'context', text: 'summary', timestamp: 5 },
      });
      const childBranchId = parseSessionBranchId('early-child');
      await compactionAdapter.applyNavigation({
        ...compactionSession,
        command: {
          operation: 'fork',
          sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
          throughTurnId: compactionTurns[0]!,
          newBranchId: childBranchId,
          expectedRevision: compactionSession.navigationRevision,
        },
      });
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
      const adapter = new SqliteSessionAdapter({ databasePath: temporary.databasePath });
      const identity = defineAgentIdentity({ id: 'cross-branch-parent-agent' });
      let session = await adapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const rootTurnId = parseTurnId('root');
      await adapter.beginTurn({
        ...session,
        turnId: rootTurnId,
        userMessage: userMessage('root', 1),
      });
      await adapter.completeTurn({
        ...session,
        turnId: rootTurnId,
        assistantMessage: assistantMessage('root answer', 2),
      });

      session = await adapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const firstBranchId = parseSessionBranchId('first-child');
      const secondBranchId = parseSessionBranchId('second-child');
      let navigation = await adapter.applyNavigation({
        ...session,
        command: {
          operation: 'fork',
          sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
          throughTurnId: rootTurnId,
          newBranchId: firstBranchId,
          expectedRevision: session.navigationRevision,
        },
      });
      navigation = await adapter.applyNavigation({
        ...session,
        command: {
          operation: 'fork',
          sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
          throughTurnId: rootTurnId,
          newBranchId: secondBranchId,
          expectedRevision: navigation.navigation.revision,
        },
      });
      await adapter.applyNavigation({
        ...session,
        command: {
          operation: 'select',
          branchId: firstBranchId,
          expectedRevision: navigation.navigation.revision,
        },
      });

      session = await adapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const firstChildTurnId = parseTurnId('first-child-turn');
      await adapter.beginTurn({
        ...session,
        turnId: firstChildTurnId,
        userMessage: userMessage('first child', 3),
      });
      await adapter.completeTurn({
        ...session,
        turnId: firstChildTurnId,
        assistantMessage: assistantMessage('first child answer', 4),
      });
      session = await adapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      await adapter.applyNavigation({
        ...session,
        command: {
          operation: 'select',
          branchId: secondBranchId,
          expectedRevision: session.navigationRevision,
        },
      });
      session = await adapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const secondChildTurnId = parseTurnId('second-child-turn');
      await adapter.beginTurn({
        ...session,
        turnId: secondChildTurnId,
        userMessage: userMessage('second child', 5),
      });

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

  it('rolls back a failed version 2 navigation migration atomically', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const adapter = new SqliteSessionAdapter({ databasePath: temporary.databasePath });
      const session = await adapter.resolve({
        agentId: defineAgentIdentity({ id: 'migration-rollback-agent' }).id,
        requestedSessionId: 'conversation',
      });
      const turnId = parseTurnId('turn');
      await adapter.beginTurn({
        ...session,
        turnId,
        userMessage: userMessage('hello', 1),
      });
      await adapter.completeTurn({
        ...session,
        turnId,
        assistantMessage: assistantMessage('answer', 2),
      });
      await adapter.commitCompaction({
        ...session,
        expectedRevision: 0,
        throughTurnId: turnId,
        context: { role: 'context', text: 'summary', timestamp: 3 },
      });
      downgradeToSchemaVersion2(temporary.databasePath);
      const corrupted = new DatabaseSync(temporary.databasePath);
      corrupted.exec('PRAGMA foreign_keys = OFF');
      corrupted.prepare('UPDATE agent_session_compactions SET through_turn_id = ?').run('missing');
      corrupted.close();

      expectSessionError(
        () => new SqliteSessionAdapter({ databasePath: temporary.databasePath }),
        'SESSION_STORAGE_FAILED'
      );
      const inspected = new DatabaseSync(temporary.databasePath);
      const version = inspected
        .prepare(
          `SELECT version FROM agent_session_schema
           WHERE component = 'session'`
        )
        .get() as { version: number };
      const columns = inspected
        .prepare('PRAGMA table_info(agent_sessions)')
        .all()
        .map((row) => (row as { name: string }).name);
      inspected.close();
      expect(version.version).toBe(2);
      expect(columns).not.toContain('selected_branch_id');
    } finally {
      temporary.dispose();
    }
  });

  it('fails fast for invalid durable storage configuration', () => {
    expectSessionError(
      () => new SqliteSessionAdapter({ databasePath: ':memory:' }),
      'SESSION_PATH_INVALID'
    );
    expectSessionError(
      () =>
        new SqliteSessionAdapter({
          databasePath: join(tmpdir(), 'unused.sqlite'),
          busyTimeoutMilliseconds: 0,
        }),
      'SESSION_CONFIGURATION_INVALID'
    );
  });
});
