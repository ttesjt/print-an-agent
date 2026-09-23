import { expect, expectTypeOf, it } from 'vitest';
import { DEFAULT_SESSION_BRANCH_ID } from '../../src/index.js';
import type {
  RetiredSessionListPage,
  SessionExecutionId,
  SessionExecutionPort,
  SessionExecutionRecoveryPort,
  SessionId,
  SessionLifecyclePort,
  SessionLifecycleInspection,
  SessionLifecycleListPage,
  SessionLifecycleQueryPort,
  SessionLifecycleSummary,
  SessionPort,
  SessionPurgePort,
  SessionQueryPort,
} from '../../src/index.js';
import { idle, reference } from '../support/lifecycle-fixtures.js';

it('keeps capabilities independent and composes them structurally', () => {
  expectTypeOf<
    Extract<keyof SessionPort, 'retireSession' | 'purgeSession'>
  >().toEqualTypeOf<never>();
  expectTypeOf<keyof SessionLifecyclePort>().toEqualTypeOf<'retireSession' | 'restoreSession'>();
  expectTypeOf<keyof SessionPurgePort>().toEqualTypeOf<'purgeSession'>();
  expectTypeOf<SessionLifecycleQueryPort>().toExtend<SessionQueryPort>();
  expectTypeOf<SessionLifecyclePort>().not.toExtend<SessionPort>();
  expectTypeOf<SessionLifecyclePort>().not.toExtend<SessionPurgePort>();
  expectTypeOf<SessionExecutionPort>().not.toExtend<SessionExecutionRecoveryPort>();
  expectTypeOf<
    SessionQueryPort & SessionLifecyclePort & SessionPurgePort
  >().toExtend<SessionLifecyclePort>();
});

it('separates Session identity from execution credentials', () => {
  expectTypeOf<SessionId>().not.toExtend<SessionExecutionId>();
  expectTypeOf<SessionExecutionId>().not.toExtend<SessionId>();
});

it('lists lifecycle summaries without requiring execution evidence', () => {
  const summary = {
    ...reference,
    title: 'Conversation',
    metadataRevision: 1,
    metadataUpdatedAt: 20,
    createdAt: 10,
    updatedAt: 20,
    selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
    navigationRevision: 0,
    branchCount: 1,
    turnCount: 0,
  };
  const active: SessionLifecycleListPage = { records: [{ ...summary, status: 'active' }] };
  const retired: RetiredSessionListPage = {
    records: [{ ...summary, status: 'retired', retiredAt: 20 }],
  };
  expect(active.records[0]).not.toHaveProperty('execution');
  expect(retired.records[0]).not.toHaveProperty('execution');
  expectTypeOf<Extract<keyof SessionLifecycleSummary, 'execution'>>().toEqualTypeOf<never>();
  expectTypeOf<SessionLifecycleListPage['records'][number]>().toExtend<SessionLifecycleSummary>();
  expectTypeOf<RetiredSessionListPage['records'][number]>().toExtend<SessionLifecycleSummary>();
  expectTypeOf<SessionLifecycleSummary>().not.toExtend<SessionLifecycleInspection>();

  const inspection: SessionLifecycleInspection = { ...summary, status: 'active', execution: idle };
  expect(inspection.execution).toEqual(idle);
  expectTypeOf<SessionLifecycleInspection['execution']>().toEqualTypeOf<typeof idle>();
});
