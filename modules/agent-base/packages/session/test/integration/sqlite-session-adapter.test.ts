import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';
import {
  AgentSessionError,
  parseTurnId,
  SqliteSessionAdapter,
  type AgentSessionErrorCode,
} from '../../src/index.js';
import {
  assistantMessage,
  defineSessionPortContract,
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
  it('migrates a valid schema version 1 database without losing authoritative turns', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'migration-agent' });
      const first = new SqliteSessionAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
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

      const oldDatabase = new DatabaseSync(temporary.databasePath);
      oldDatabase.exec('DROP TABLE ta_agent_base_session_compactions');
      oldDatabase
        .prepare(
          `UPDATE ta_agent_base_session_schema
           SET version = 1 WHERE component = '@ta-agent/base-session'`
        )
        .run();
      oldDatabase.close();

      const migrated = new SqliteSessionAdapter({ databasePath: temporary.databasePath });
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
      expect(await migrated.readCompaction(session)).toBeUndefined();
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
        assistantMessage: assistantMessage('first', 2),
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
      ).toEqual([userMessage('one', 1), assistantMessage('first', 2)]);
      expect((await reopened.inspect(reopenedSession))?.turns.map((turn) => turn.status)).toEqual([
        'completed',
        'active',
      ]);
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
      const session = await firstAdapter.resolve({
        agentId: identity.id,
        requestedSessionId: 'conversation',
      });
      const interruptedId = parseTurnId('interrupted');
      const untouchedId = parseTurnId('untouched');
      await firstAdapter.beginTurn({
        ...session,
        turnId: interruptedId,
        userMessage: userMessage('recover me', 1),
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
          `UPDATE ta_agent_base_session_schema
           SET version = 3 WHERE component = '@ta-agent/base-session'`
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
        'ALTER TABLE ta_agent_base_session_turns RENAME COLUMN failure_code TO unexpected_code'
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
      corruptDatabase
        .prepare('UPDATE ta_agent_base_session_turns SET user_message = ?')
        .run('{bad json');
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
      database
        .prepare('UPDATE ta_agent_base_session_compactions SET context_message = ?')
        .run('{bad json');
      database.close();

      await expect(adapter.readCompaction(session)).rejects.toMatchObject({
        code: 'SESSION_RECORD_INVALID',
      });
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
