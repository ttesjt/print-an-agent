import type { SessionBranchId, SessionNavigationSnapshot } from '../../contracts/index.js';
import type { SessionNavigationOperation } from './command.js';

export interface AppliedSessionNavigation {
  readonly operation: Exclude<SessionNavigationOperation, 'inspect'>;
  readonly affectedBranchId: SessionBranchId;
  readonly navigation: SessionNavigationSnapshot;
}

export type SessionNavigationOutcome =
  | Readonly<{
      status: 'inspected';
      navigation: SessionNavigationSnapshot;
    }>
  | Readonly<{
      status: 'selected';
      sessionId: string;
      selectedBranchId: SessionBranchId;
      affectedBranchId: SessionBranchId;
      revision: number;
    }>
  | Readonly<{
      status: 'forked';
      sessionId: string;
      selectedBranchId: SessionBranchId;
      affectedBranchId: SessionBranchId;
      revision: number;
    }>
  | Readonly<{
      status: 'rewound';
      sessionId: string;
      selectedBranchId: SessionBranchId;
      affectedBranchId: SessionBranchId;
      revision: number;
    }>;
