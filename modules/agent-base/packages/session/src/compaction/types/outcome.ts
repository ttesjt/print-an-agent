import type { SessionBranchId, TurnId } from '../../contracts/index.js';

export type SessionCompactionSkipReason = 'not-needed';

export type SessionCompactionOutcome =
  | Readonly<{
      status: 'skipped';
      sessionId: string;
      branchId: SessionBranchId;
      reason: SessionCompactionSkipReason;
    }>
  | Readonly<{
      status: 'compacted';
      sessionId: string;
      branchId: SessionBranchId;
      revision: number;
      throughTurnId: TurnId;
      compactedTurnCount: number;
    }>;
