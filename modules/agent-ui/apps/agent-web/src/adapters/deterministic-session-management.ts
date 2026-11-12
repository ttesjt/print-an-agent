import type {
  ChangeSessionLifecycleInput,
  ConversationSessionAdmission,
  ForkSessionBranchInput,
  InspectSessionInput,
  InspectSessionNavigationInput,
  ListSessionsInput,
  PurgeSessionInput,
  RenameSessionInput,
  RewindSessionBranchInput,
  SelectSessionBranchInput,
  SessionBranchSummary,
  SessionBranchMutationResult,
  SessionDetails,
  SessionManagementResult,
  SessionNavigationSnapshot,
  SessionRevision,
} from '@print-an-agent/ui-contracts';

import type { SessionManagementPort } from '../application/ports.js';

export interface DeterministicSessionManagement extends SessionManagementPort {
  readonly conversationStore: DeterministicConversationSessionStore;
}

export interface CommitDeterministicConversationTurnInput {
  readonly agentId: string;
  readonly branchId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly turnId: string;
}

export interface DeterministicConversationSessionStore {
  admitSession(
    input: Readonly<{ agentId: string; branchId: string; sessionId: string }>
  ): ConversationSessionAdmission;
  commitTurn(input: CommitDeterministicConversationTurnInput): void;
  forkBranch(input: ForkSessionBranchInput): SessionManagementResult<SessionBranchMutationResult>;
  rewindBranch(
    input: RewindSessionBranchInput
  ): SessionManagementResult<SessionBranchMutationResult>;
}

interface MutableSessionRecord {
  agentId: string;
  branches: SessionBranchSummary[];
  createdAt: string;
  metadataRevision: number;
  navigationRevision: number;
  retiredAt?: string;
  selectedBranchId: string;
  status: SessionDetails['status'];
  title?: string;
  turnCount: number;
  turnIdsByBranch: Map<string, string[]>;
  updatedAt: string;
}

const INITIAL_TIME = Date.parse('2026-02-01T00:00:00.000Z');
const DEFAULT_PAGE_LIMIT = 2;

export function createDeterministicSessionManagement(): DeterministicSessionManagement {
  const records = new Map<string, MutableSessionRecord>([
    [
      'research-session-1',
      sessionRecord({
        agentId: 'research-assistant',
        branches: [
          branch('main', 0, { headTurnId: 'turn-3' }),
          branch('alternative', 1, {
            forkedFromTurnId: 'turn-2',
            headTurnId: 'turn-4',
            parentBranchId: 'main',
          }),
        ],
        offset: 3,
        selectedBranchId: 'main',
        title: 'Evidence review',
        turnCount: 4,
        turnIdsByBranch: {
          alternative: ['turn-1', 'turn-2', 'turn-4'],
          main: ['turn-1', 'turn-2', 'turn-3'],
        },
      }),
    ],
    [
      'research-session-2',
      sessionRecord({
        agentId: 'research-assistant',
        branches: [branch('main', 4, { headTurnId: 'turn-6' })],
        offset: 5,
        selectedBranchId: 'main',
        title: 'Source comparison',
        turnCount: 2,
        turnIdsByBranch: { main: ['turn-5', 'turn-6'] },
      }),
    ],
    [
      'research-session-3',
      sessionRecord({
        agentId: 'research-assistant',
        branches: [branch('main', 6)],
        offset: 7,
        selectedBranchId: 'main',
        turnCount: 0,
        turnIdsByBranch: { main: [] },
      }),
    ],
    [
      'research-session-retired',
      sessionRecord({
        agentId: 'research-assistant',
        branches: [branch('main', 8, { headTurnId: 'turn-8' })],
        offset: 9,
        retired: true,
        selectedBranchId: 'main',
        title: 'Archived exploration',
        turnCount: 1,
        turnIdsByBranch: { main: ['turn-8'] },
      }),
    ],
    [
      'review-session-1',
      sessionRecord({
        agentId: 'review-assistant',
        branches: [branch('main', 10, { headTurnId: 'turn-10' })],
        offset: 11,
        selectedBranchId: 'main',
        title: 'Change review',
        turnCount: 3,
        turnIdsByBranch: { main: ['turn-9', 'turn-10', 'turn-11'] },
      }),
    ],
  ]);
  let logicalClock = 20;
  let generatedBranchCount = 0;
  const now = () => new Date(INITIAL_TIME + logicalClock++ * 1_000).toISOString();

  return Object.freeze({
    conversationStore: Object.freeze({
      admitSession: (input: Readonly<{ agentId: string; branchId: string; sessionId: string }>) => {
        let record = records.get(input.sessionId);
        if (record === undefined) {
          const timestamp = now();
          record = sessionRecord({
            agentId: input.agentId,
            branches: [{ branchId: input.branchId, createdAt: timestamp }],
            createdAt: timestamp,
            updatedAt: timestamp,
            selectedBranchId: input.branchId,
            turnCount: 0,
            turnIdsByBranch: { [input.branchId]: [] },
          });
          records.set(input.sessionId, record);
        }
        if (record.agentId !== input.agentId || record.status !== 'active')
          throw new Error('Session admission is invalid.');
        return {
          details: details(input.sessionId, record),
          navigation: navigation(input.sessionId, record),
        };
      },
      commitTurn: (input: CommitDeterministicConversationTurnInput) =>
        commitTurn(records, input, now),
      forkBranch: (input: ForkSessionBranchInput) =>
        mutateBranch(records, input, 'fork', now, () => {
          generatedBranchCount += 1;
          return `fork-${String(generatedBranchCount)}`;
        }),
      rewindBranch: (input: RewindSessionBranchInput) =>
        mutateBranch(records, input, 'rewind', now, () => {
          generatedBranchCount += 1;
          return `rewind-${String(generatedBranchCount)}`;
        }),
    }),
    inspectSession: (input: InspectSessionInput) => defer(() => inspect(records, input)),
    inspectSessionNavigation: (input: InspectSessionNavigationInput) =>
      defer(() => inspectNavigation(records, input)),
    listSessions: (input: ListSessionsInput) => defer(() => list(records, input)),
    purgeSession: (input: PurgeSessionInput) => defer(() => purge(records, input)),
    renameSession: (input: RenameSessionInput) => defer(() => rename(records, input, now)),
    restoreSession: (input: ChangeSessionLifecycleInput) =>
      defer(() => changeLifecycle(records, input, 'active', now)),
    retireSession: (input: ChangeSessionLifecycleInput) =>
      defer(() => changeLifecycle(records, input, 'retired', now)),
    selectSessionBranch: (input: SelectSessionBranchInput) =>
      defer(() => selectBranch(records, input, now)),
  });
}

function list(records: ReadonlyMap<string, MutableSessionRecord>, input: ListSessionsInput) {
  input.signal?.throwIfAborted();
  const offset = decodeCursor(input.cursor);
  const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
  const matching = [...records.entries()]
    .filter(([, record]) => record.agentId === input.agentId && record.status === input.status)
    .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt));
  const page = matching.slice(offset, offset + limit);
  return succeeded({
    ...(offset + page.length < matching.length
      ? { nextCursor: encodeCursor(offset + page.length) }
      : {}),
    records: Object.freeze(page.map(([sessionId, record]) => details(sessionId, record))),
  });
}

function inspect(records: ReadonlyMap<string, MutableSessionRecord>, input: InspectSessionInput) {
  input.signal?.throwIfAborted();
  const record = records.get(input.sessionId);
  return record === undefined || record.agentId !== input.agentId
    ? failed('not-found', 'The selected Session no longer exists.')
    : succeeded(details(input.sessionId, record));
}

function inspectNavigation(
  records: ReadonlyMap<string, MutableSessionRecord>,
  input: InspectSessionNavigationInput
) {
  input.signal?.throwIfAborted();
  const record = records.get(input.sessionId);
  return record === undefined || record.agentId !== input.agentId
    ? failed('not-found', 'The selected Session no longer exists.')
    : succeeded(navigation(input.sessionId, record));
}

function rename(
  records: Map<string, MutableSessionRecord>,
  input: RenameSessionInput,
  now: () => string
) {
  input.signal?.throwIfAborted();
  const record = records.get(input.sessionId);
  if (record === undefined || record.agentId !== input.agentId) {
    return failed('not-found', 'The selected Session no longer exists.');
  }
  const currentRevision = revision(record.metadataRevision);
  if (input.expectedRevision !== currentRevision) {
    return conflict(currentRevision, 'The Session metadata changed after it was loaded.');
  }
  const title = input.title.trim();
  if (title.length === 0 || title.length > 120) {
    return validationFailed('title', 'Session title must contain 1–120 characters.');
  }
  record.title = title;
  record.metadataRevision += 1;
  record.updatedAt = now();
  return succeeded(details(input.sessionId, record));
}

function changeLifecycle(
  records: Map<string, MutableSessionRecord>,
  input: ChangeSessionLifecycleInput,
  target: SessionDetails['status'],
  now: () => string
) {
  input.signal?.throwIfAborted();
  const record = records.get(input.sessionId);
  if (record === undefined || record.agentId !== input.agentId) {
    return failed('not-found', 'The selected Session no longer exists.');
  }
  const currentRevision = revision(record.metadataRevision);
  if (input.expectedRevision !== currentRevision) {
    return conflict(currentRevision, 'The Session lifecycle changed after it was loaded.');
  }
  if (record.status === target) {
    return failed('invalid-transition', `The Session is already ${target}.`);
  }
  const timestamp = now();
  record.status = target;
  record.metadataRevision += 1;
  record.updatedAt = timestamp;
  if (target === 'retired') record.retiredAt = timestamp;
  else delete record.retiredAt;
  return succeeded(details(input.sessionId, record));
}

function purge(records: Map<string, MutableSessionRecord>, input: PurgeSessionInput) {
  input.signal?.throwIfAborted();
  const record = records.get(input.sessionId);
  if (record === undefined || record.agentId !== input.agentId) {
    return failed('not-found', 'The selected Session no longer exists.');
  }
  const currentRevision = revision(record.metadataRevision);
  if (input.expectedRevision !== currentRevision) {
    return conflict(currentRevision, 'The Session lifecycle changed after it was loaded.');
  }
  if (record.status !== 'retired') {
    return failed('invalid-transition', 'Only a retired Session can be permanently deleted.');
  }
  records.delete(input.sessionId);
  return succeeded(undefined);
}

function commitTurn(
  records: Map<string, MutableSessionRecord>,
  input: CommitDeterministicConversationTurnInput,
  now: () => string
): void {
  const timestamp = now();
  const existing = records.get(input.sessionId);
  if (existing === undefined) {
    records.set(
      input.sessionId,
      sessionRecord({
        agentId: input.agentId,
        branches: [
          Object.freeze({
            branchId: input.branchId,
            createdAt: timestamp,
            headTurnId: input.turnId,
          }),
        ],
        createdAt: timestamp,
        selectedBranchId: input.branchId,
        title: input.title,
        turnCount: 1,
        turnIdsByBranch: { [input.branchId]: [input.turnId] },
        updatedAt: timestamp,
      })
    );
    return;
  }
  if (existing.agentId !== input.agentId || existing.status !== 'active') {
    throw new Error('Deterministic conversation cannot commit to the selected Session.');
  }
  const lineage = existing.turnIdsByBranch.get(input.branchId);
  if (lineage === undefined) {
    throw new Error('Deterministic conversation branch no longer exists.');
  }
  if (!lineage.includes(input.turnId)) {
    if (existing.turnCount === 0 && existing.title === undefined) existing.title = input.title;
    lineage.push(input.turnId);
    existing.turnCount += 1;
  }
  existing.branches = existing.branches.map((candidate) =>
    candidate.branchId === input.branchId
      ? Object.freeze({ ...candidate, headTurnId: input.turnId })
      : candidate
  );
  existing.updatedAt = timestamp;
}

function mutateBranch(
  records: Map<string, MutableSessionRecord>,
  input: ForkSessionBranchInput | RewindSessionBranchInput,
  operation: 'fork' | 'rewind',
  now: () => string,
  createBranchId: () => string
): SessionManagementResult<SessionBranchMutationResult> {
  input.signal?.throwIfAborted();
  const record = records.get(input.sessionId);
  if (record === undefined || record.agentId !== input.agentId) {
    return failed('not-found', 'The selected Session no longer exists.');
  }
  const currentRevision = revision(record.navigationRevision);
  if (input.expectedRevision !== currentRevision) {
    return conflict(currentRevision, 'Session navigation changed after it was loaded.');
  }
  const sourceBranchId =
    operation === 'fork' && 'sourceBranchId' in input
      ? input.sourceBranchId
      : record.selectedBranchId;
  const sourceLineage = record.turnIdsByBranch.get(sourceBranchId);
  const throughIndex = sourceLineage?.indexOf(input.throughTurnId) ?? -1;
  if (sourceLineage === undefined || throughIndex < 0) {
    return failed('not-found', 'The selected turn is not available on the source branch.');
  }
  const branchId = input.newBranchId ?? createBranchId();
  if (record.turnIdsByBranch.has(branchId)) {
    return failed('invalid-transition', 'The requested branch identity already exists.');
  }
  const timestamp = now();
  record.turnIdsByBranch.set(branchId, sourceLineage.slice(0, throughIndex + 1));
  record.branches = [
    ...record.branches,
    Object.freeze({
      branchId,
      createdAt: timestamp,
      forkedFromTurnId: input.throughTurnId,
      headTurnId: input.throughTurnId,
      parentBranchId: sourceBranchId,
    }),
  ];
  if (operation === 'rewind') record.selectedBranchId = branchId;
  record.navigationRevision += 1;
  record.updatedAt = timestamp;
  const nextNavigation = navigation(input.sessionId, record);
  return succeeded(Object.freeze({ affectedBranchId: branchId, navigation: nextNavigation }));
}

function selectBranch(
  records: Map<string, MutableSessionRecord>,
  input: SelectSessionBranchInput,
  now: () => string
) {
  input.signal?.throwIfAborted();
  const record = records.get(input.sessionId);
  if (record === undefined || record.agentId !== input.agentId) {
    return failed('not-found', 'The selected Session no longer exists.');
  }
  const currentRevision = revision(record.navigationRevision);
  if (input.expectedRevision !== currentRevision) {
    return conflict(currentRevision, 'Session navigation changed after it was loaded.');
  }
  if (!record.branches.some((candidate) => candidate.branchId === input.branchId)) {
    return failed('not-found', 'The selected branch no longer exists.');
  }
  record.selectedBranchId = input.branchId;
  record.navigationRevision += 1;
  record.updatedAt = now();
  return succeeded(navigation(input.sessionId, record));
}

function details(sessionId: string, record: MutableSessionRecord): SessionDetails {
  const common = {
    agentId: record.agentId,
    branchCount: record.branches.length,
    createdAt: record.createdAt,
    metadataRevision: revision(record.metadataRevision),
    navigationRevision: revision(record.navigationRevision),
    selectedBranchId: record.selectedBranchId,
    sessionId,
    ...(record.title === undefined ? {} : { title: record.title }),
    turnCount: record.turnCount,
    updatedAt: record.updatedAt,
  };
  return record.status === 'retired'
    ? Object.freeze({ ...common, retiredAt: requireRetiredAt(record), status: 'retired' })
    : Object.freeze({ ...common, status: 'active' });
}

function navigation(sessionId: string, record: MutableSessionRecord): SessionNavigationSnapshot {
  return Object.freeze({
    agentId: record.agentId,
    branches: Object.freeze(record.branches.map((candidate) => Object.freeze({ ...candidate }))),
    revision: revision(record.navigationRevision),
    selectedBranchId: record.selectedBranchId,
    sessionId,
  });
}

function sessionRecord(input: {
  agentId: string;
  branches: SessionBranchSummary[];
  offset?: number;
  createdAt?: string;
  retired?: boolean;
  selectedBranchId: string;
  title?: string;
  turnCount: number;
  turnIdsByBranch: Readonly<Record<string, readonly string[]>>;
  updatedAt?: string;
}): MutableSessionRecord {
  const offset = input.offset ?? 0;
  const createdAt = input.createdAt ?? new Date(INITIAL_TIME + offset * 1_000).toISOString();
  const updatedAt = input.updatedAt ?? new Date(INITIAL_TIME + (offset + 1) * 1_000).toISOString();
  return {
    agentId: input.agentId,
    branches: input.branches,
    createdAt,
    metadataRevision: 1,
    navigationRevision: 1,
    ...(input.retired ? { retiredAt: updatedAt } : {}),
    selectedBranchId: input.selectedBranchId,
    status: input.retired ? 'retired' : 'active',
    ...(input.title === undefined ? {} : { title: input.title }),
    turnCount: input.turnCount,
    turnIdsByBranch: new Map(
      Object.entries(input.turnIdsByBranch).map(([branchId, turnIds]) => [branchId, [...turnIds]])
    ),
    updatedAt,
  };
}

function branch(
  branchId: string,
  offset: number,
  optional: Omit<SessionBranchSummary, 'branchId' | 'createdAt'> = {}
): SessionBranchSummary {
  return Object.freeze({
    branchId,
    createdAt: new Date(INITIAL_TIME + offset * 1_000).toISOString(),
    ...optional,
  });
}

function defer<Value>(operation: () => Value): Promise<Value> {
  return Promise.resolve().then(operation);
}

function revision(value: number): SessionRevision {
  return `revision-${String(value)}`;
}

function encodeCursor(offset: number) {
  return `cursor-${String(offset)}`;
}

function decodeCursor(cursor: string | undefined) {
  if (cursor === undefined) return 0;
  const match = /^cursor-(\d+)$/u.exec(cursor);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

function requireRetiredAt(record: MutableSessionRecord) {
  if (record.retiredAt === undefined) {
    throw new Error('Retired deterministic Session is missing retiredAt.');
  }
  return record.retiredAt;
}

function succeeded<Value>(value: Value): SessionManagementResult<Value> {
  return Object.freeze({ status: 'succeeded', value });
}

function failed(
  code: 'invalid-transition' | 'not-found' | 'operation-failed' | 'session-busy' | 'unavailable',
  message: string
): SessionManagementResult<never> {
  return Object.freeze({ failure: Object.freeze({ code, message }), status: 'failed' });
}

function conflict(
  currentRevision: SessionRevision,
  message: string
): SessionManagementResult<never> {
  return Object.freeze({
    failure: Object.freeze({ code: 'revision-conflict', currentRevision, message }),
    status: 'failed',
  });
}

function validationFailed(field: string, message: string): SessionManagementResult<never> {
  return Object.freeze({
    failure: Object.freeze({
      code: 'validation-failed',
      fieldErrors: Object.freeze([Object.freeze({ field, message })]),
      message: 'The Session metadata is invalid.',
    }),
    status: 'failed',
  });
}
