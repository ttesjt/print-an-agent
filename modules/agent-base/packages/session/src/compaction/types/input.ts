import type { SessionCompactionTarget } from '../planning/types.js';

export interface CompactSessionInput {
  readonly sessionId: string;
  readonly branchId?: string;
  readonly target?: SessionCompactionTarget;
}
