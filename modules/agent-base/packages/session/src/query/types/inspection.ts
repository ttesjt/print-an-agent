import type { SessionBranchId, SessionReference } from '../../contracts/index.js';

export interface SessionSummary extends SessionReference {
  readonly title?: string;
  readonly metadataRevision: number;
  readonly metadataUpdatedAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly selectedBranchId: SessionBranchId;
  readonly navigationRevision: number;
  readonly branchCount: number;
  readonly turnCount: number;
}

export type SessionInspection = SessionSummary;
