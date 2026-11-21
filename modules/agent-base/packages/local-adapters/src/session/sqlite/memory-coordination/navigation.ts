import type { PublishSessionMemoryNavigation } from '@print-an-agent/base-session';
import { AgentSessionError, type AppliedSessionNavigation } from '@print-an-agent/base-session';
import { runImmediateTransaction } from '../database.js';
import { normalizeNavigationRequest } from '../input.js';
import { assertSqliteSessionWrite } from '../lifecycle/execution.js';
import { advanceSqliteExecution, readSqliteLifecycle } from '../lifecycle/state.js';
import { applySqliteSessionNavigation } from '../navigation/apply.js';
import { loadSqliteSessionSnapshot } from '../snapshot.js';
import type { SqliteSessionMemoryContext } from '../types/memory-coordination.js';
import { readSessionMemoryRecord, writeSessionMemoryRecord } from './records.js';

export function publishSqliteMemoryNavigation(
  context: SqliteSessionMemoryContext,
  input: PublishSessionMemoryNavigation
): Promise<AppliedSessionNavigation> {
  return Promise.resolve().then(() =>
    context.useDatabase('publish Memory navigation', (db) =>
      runImmediateTransaction(db, () => {
        if (input.execution !== undefined) assertSqliteSessionWrite(db, input, context.tableNames);
        const { snapshot, fence } = readSqliteLifecycle(db, input, context.tableNames);
        if (
          snapshot.status !== 'active' ||
          (input.execution === undefined && fence.activeLeaseCount !== 0) ||
          loadSqliteSessionSnapshot(db, input, context.tableNames)?.turns.some(
            (turn) => turn.status === 'active'
          )
        )
          throw new AgentSessionError(
            'SESSION_BUSY',
            'Memory navigation requires an idle Session.'
          );
        const intent = readSessionMemoryRecord(
          db,
          { ...input, kind: 'navigation', id: input.intentId },
          context.tableNames
        );
        if (
          intent === undefined ||
          intent.settled ||
          intent.revision !== input.expectedIntentRevision
        )
          throw new AgentSessionError(
            'SESSION_MEMORY_CONFLICT',
            'Memory navigation intent changed.'
          );
        const applied = applySqliteSessionNavigation(
          db,
          normalizeNavigationRequest(input),
          context.createBranchId,
          context.clock,
          context.tableNames
        );
        if (input.binding !== undefined) {
          if (input.binding.id !== applied.affectedBranchId)
            throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory binding branch differs.');
          writeSessionMemoryRecord(
            db,
            {
              ...input,
              kind: 'binding',
              id: input.binding.id,
              value: input.binding.value,
              expectedRevision: null,
              settled: true,
            },
            context.tableNames
          );
        }
        writeSessionMemoryRecord(
          db,
          {
            ...input,
            kind: 'navigation',
            id: input.intentId,
            expectedRevision: intent.revision,
            settled: true,
            value: JSON.stringify({ ...(JSON.parse(intent.value) as object), applied }),
          },
          context.tableNames
        );
        advanceSqliteExecution(db, input, context.tableNames);
        return applied;
      })
    )
  );
}
