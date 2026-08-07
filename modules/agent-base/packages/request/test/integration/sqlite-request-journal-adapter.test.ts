import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteSessionAdapter } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  AgentRequestError,
  createRequestFingerprint,
  SqliteRequestJournalAdapter,
  type AgentRequestErrorCode,
} from '../../src/index.js';
import {
  defineRequestJournalContract,
  journalReference,
  journalResponse,
} from '../support/request-journal-contract.js';

interface TemporaryDatabase {
  readonly databasePath: string;
  readonly dispose: () => void;
}

function createTemporaryDatabase(): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'ta-agent-request-journal-'));
  return Object.freeze({
    databasePath: join(directory, 'agent.sqlite'),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  });
}

function createClock(): () => number {
  let current = 100;
  return () => ++current;
}

function expectRequestError(action: () => unknown, code: AgentRequestErrorCode): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toEqual(expect.objectContaining<Partial<AgentRequestError>>({ code }));
}

defineRequestJournalContract('SqliteRequestJournalAdapter', () => {
  const temporary = createTemporaryDatabase();
  return {
    journal: new SqliteRequestJournalAdapter({
      databasePath: temporary.databasePath,
      clock: createClock(),
    }),
    dispose: temporary.dispose,
  };
});

describe('SqliteRequestJournalAdapter durability', () => {
  it('reopens the exact completed response', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const reference = journalReference();
      const first = new SqliteRequestJournalAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      await first.claim({
        ...reference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'request-1',
      });
      const completed = await first.complete({
        ...reference,
        requestId: 'request-1',
        response: journalResponse('request-1'),
      });

      const reopened = new SqliteRequestJournalAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      expect(await reopened.inspect(reference)).toEqual(completed);
      expect(
        await reopened.claim({
          ...reference,
          fingerprint: createRequestFingerprint({ message: 'hello' }),
          requestId: 'request-2',
        })
      ).toMatchObject({
        status: 'existing',
        entry: { status: 'completed', requestId: 'request-1' },
      });
    } finally {
      temporary.dispose();
    }
  });

  it('supports exact active-record recovery after restart', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const reference = journalReference();
      const first = new SqliteRequestJournalAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      await first.claim({
        ...reference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'interrupted-request',
      });

      const reopened = new SqliteRequestJournalAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      await expect(
        reopened.fail({
          ...reference,
          requestId: 'wrong-request',
          failure: { code: 'INTERRUPTED', message: 'wrong owner' },
        })
      ).rejects.toEqual(
        expect.objectContaining<Partial<AgentRequestError>>({
          code: 'REQUEST_REPLAY_STATE_INVALID',
        })
      );
      expect(
        await reopened.fail({
          ...reference,
          requestId: 'interrupted-request',
          failure: { code: 'PROCESS_INTERRUPTED', message: 'process ended' },
        })
      ).toMatchObject({ status: 'failed', failure: { code: 'PROCESS_INTERRUPTED' } });
    } finally {
      temporary.dispose();
    }
  });

  it('rejects future schemas, schema drift, and malformed response records', async () => {
    const future = createTemporaryDatabase();
    const drift = createTemporaryDatabase();
    const corrupt = createTemporaryDatabase();
    try {
      new SqliteRequestJournalAdapter({ databasePath: future.databasePath });
      const futureDatabase = new DatabaseSync(future.databasePath);
      futureDatabase
        .prepare(
          `UPDATE ta_agent_base_request_journal_schema
           SET version = 2 WHERE component = '@ta-agent/base-request:journal'`
        )
        .run();
      futureDatabase.close();
      expectRequestError(
        () => new SqliteRequestJournalAdapter({ databasePath: future.databasePath }),
        'REQUEST_REPLAY_SCHEMA_UNSUPPORTED'
      );

      new SqliteRequestJournalAdapter({ databasePath: drift.databasePath });
      const driftDatabase = new DatabaseSync(drift.databasePath);
      driftDatabase.exec(
        'ALTER TABLE ta_agent_base_request_journal_entries RENAME COLUMN failure_code TO unexpected_code'
      );
      driftDatabase.close();
      expectRequestError(
        () => new SqliteRequestJournalAdapter({ databasePath: drift.databasePath }),
        'REQUEST_REPLAY_SCHEMA_INVALID'
      );

      const journal = new SqliteRequestJournalAdapter({
        databasePath: corrupt.databasePath,
        clock: createClock(),
      });
      const reference = journalReference();
      await journal.claim({
        ...reference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'request-1',
      });
      await journal.complete({
        ...reference,
        requestId: 'request-1',
        response: journalResponse('request-1'),
      });
      const corruptDatabase = new DatabaseSync(corrupt.databasePath);
      corruptDatabase
        .prepare('UPDATE ta_agent_base_request_journal_entries SET response_json = ?')
        .run('{bad json');
      corruptDatabase.close();
      await expect(journal.inspect(reference)).rejects.toEqual(
        expect.objectContaining<Partial<AgentRequestError>>({
          code: 'REQUEST_REPLAY_RECORD_INVALID',
        })
      );
    } finally {
      future.dispose();
      drift.dispose();
      corrupt.dispose();
    }
  });

  it('coexists with durable Session tables in one physical database', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const reference = journalReference();
      const session = new SqliteSessionAdapter({ databasePath: temporary.databasePath });
      await session.resolve({
        agentId: reference.agentId,
        requestedSessionId: reference.sessionId,
      });

      const journal = new SqliteRequestJournalAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      await journal.claim({
        ...reference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'request-1',
      });

      expect(await session.inspect(reference)).toMatchObject({ turns: [] });
      expect(await journal.inspect(reference)).toMatchObject({ status: 'active' });
    } finally {
      temporary.dispose();
    }
  });

  it('fails fast for invalid durable configuration', () => {
    expectRequestError(
      () => new SqliteRequestJournalAdapter({ databasePath: ':memory:' }),
      'REQUEST_REPLAY_PATH_INVALID'
    );
    expectRequestError(
      () =>
        new SqliteRequestJournalAdapter({
          databasePath: join(tmpdir(), 'unused-request-journal.sqlite'),
          busyTimeoutMilliseconds: 0,
        }),
      'REQUEST_REPLAY_CONFIGURATION_INVALID'
    );
  });
});
