import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseAgentId } from '@print-an-agent/base-identity';
import { parseTurnId, parseSessionBranchId } from '@print-an-agent/base-session';
import { MemorySessionAdapter, SqliteSessionAdapter } from '../../src/index.js';
import { assistantMessage } from '../support/session-port-contract.js';

for (const storage of ['memory', 'sqlite'] as const) {
  it(`${storage}: publishes navigation and binding atomically and fences pending admission`, async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'acm-navigation-')), 'session.sqlite');
    const session =
      storage === 'sqlite'
        ? new SqliteSessionAdapter({ databasePath: path })
        : new MemorySessionAdapter();
    const ref = await session.resolve({ agentId: parseAgentId('atomic') });
    const lease = await session.acquireSessionExecution(ref);
    const turnId = parseTurnId('one');
    await session.beginTurn({
      ...ref,
      execution: lease,
      turnId,
      userMessage: { role: 'user', text: 'hi', timestamp: 1 },
    });
    await session.completeTurn({
      ...ref,
      execution: lease,
      turnId,
      assistantMessage: assistantMessage('hi', 2),
    });
    const snapshot = await session.inspect(ref);
    if (snapshot === undefined) throw new Error('Missing Session');
    const row = await session.writeMemoryRecord({
      ...ref,
      execution: lease,
      kind: 'navigation',
      id: 'fork',
      expectedRevision: null,
      settled: false,
      value: '{"format":1}',
    });
    const current = await session.resolve({ agentId: ref.agentId, sessionId: ref.sessionId });
    await expect(
      session.beginTurn({
        ...current,
        execution: lease,
        turnId: parseTurnId('two'),
        userMessage: { role: 'user', text: 'blocked', timestamp: 3 },
      })
    ).rejects.toMatchObject({ code: 'SESSION_MEMORY_PENDING' });
    const publish = {
      ...ref,
      execution: lease,
      intentId: row.id,
      expectedIntentRevision: row.revision,
      command: {
        operation: 'rewind' as const,
        throughTurnId: turnId,
        newBranchId: parseSessionBranchId('forked'),
        expectedRevision: snapshot.navigation.revision,
      },
    };
    await expect(
      session.publishMemoryNavigation({ ...publish, binding: { id: 'wrong', value: '{}' } })
    ).rejects.toMatchObject({ code: 'SESSION_MEMORY_INVALID' });
    expect((await session.inspect(ref))?.navigation).toEqual(snapshot.navigation);
    expect(await session.listPendingMemoryRecords(ref)).toHaveLength(1);
    const result = await session.publishMemoryNavigation({
      ...publish,
      binding: { id: 'forked', value: '{"format":1,"memoryId":"detached"}' },
    });
    expect(result.navigation.selectedBranchId).toBe('forked');
    expect(
      (await session.readMemoryRecord({ ...ref, kind: 'binding', id: 'forked' }))?.settled
    ).toBe(true);
    expect(await session.listPendingMemoryRecords(ref)).toHaveLength(0);
    await session.releaseSessionExecution(lease);
  });
  it(`${storage}: keeps CAS records scoped, pending, fenced and recoverable`, async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'acm-records-')), 'session.sqlite');
    const session =
      storage === 'sqlite'
        ? new SqliteSessionAdapter({ databasePath: path })
        : new MemorySessionAdapter();
    const ref = await session.resolve({ agentId: parseAgentId('a') });
    const key = {
      agentId: ref.agentId,
      sessionId: ref.sessionId,
      kind: 'mutation' as const,
      id: 'request-1',
    };
    const first = await session.writeMemoryRecord({
      ...key,
      expectedRevision: null,
      settled: false,
      value: '{"format":1}',
    });
    expect(first.revision).toBe(1);
    expect(await session.listPendingMemoryRecords(ref)).toHaveLength(1);
    await expect(
      session.writeMemoryRecord({ ...key, expectedRevision: null, settled: true, value: '{}' })
    ).rejects.toMatchObject({ code: 'SESSION_MEMORY_CONFLICT' });
    const before = await session.inspectSession(ref);
    if (before === undefined) throw new Error('Missing Session');
    await expect(
      session.recoverSessionExecutions({
        agentId: ref.agentId,
        sessionId: ref.sessionId,
        expectedExecutionRevision: before.execution.revision,
      })
    ).rejects.toMatchObject({ code: 'SESSION_RECOVERY_FAILED' });
    expect((await session.inspectSession(ref))?.execution.state).toBe('recovering');
    const reopened =
      storage === 'sqlite' ? new SqliteSessionAdapter({ databasePath: path }) : session;
    expect(await reopened.readMemoryRecord(key)).toEqual(first);
    await reopened.writeMemoryRecord({
      ...key,
      expectedRevision: 1,
      settled: true,
      value: '{"format":1,"receipt":"confirmed"}',
    });
    const recovering = await session.inspectSession(ref);
    if (recovering === undefined) throw new Error('Missing Session');
    expect(
      (
        await session.recoverSessionExecutions({
          agentId: ref.agentId,
          sessionId: ref.sessionId,
          expectedExecutionRevision: recovering.execution.revision,
        })
      ).state
    ).toBe('ready');
    const lease = await session.acquireSessionExecution(ref);
    await expect(
      session.writeMemoryRecord({ ...key, expectedRevision: 2, settled: true, value: '{}' })
    ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    await session.releaseSessionExecution(lease);
    await expect(
      session.writeMemoryRecord({
        ...key,
        execution: lease,
        expectedRevision: 2,
        settled: true,
        value: '{}',
      })
    ).rejects.toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
    const other = await session.resolve({ agentId: ref.agentId });
    expect(await session.readMemoryRecord({ ...key, sessionId: other.sessionId })).toBeUndefined();
  });
}
