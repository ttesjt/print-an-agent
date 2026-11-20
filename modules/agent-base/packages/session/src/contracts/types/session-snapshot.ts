import type { SessionBranchId, TurnId } from './identifiers.js';
import type { SessionReference } from './session-reference.js';
import type { SessionTurn } from './turn.js';

export interface SessionBranchSnapshot {
  readonly branchId: SessionBranchId;
  readonly parentBranchId?: SessionBranchId;
  readonly forkedFromTurnId?: TurnId;
  readonly headTurnId?: TurnId;
  readonly createdAt: number;
}

export interface SessionNavigationSnapshot extends SessionReference {
  readonly revision: number;
  readonly selectedBranchId: SessionBranchId;
  readonly branches: readonly SessionBranchSnapshot[];
}

export interface SessionSnapshot extends SessionReference {
  readonly navigation: SessionNavigationSnapshot;
  readonly turns: readonly SessionTurn[];
}

/** Read authority shared by features without requiring runtime write capabilities. */
export interface SessionInspectionPort {
  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined>;
}
