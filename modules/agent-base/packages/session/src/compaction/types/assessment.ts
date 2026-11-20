import type { SessionCompactionRejectionReason } from '../rejection-reasons.js';

export type SessionCompactionAssessment =
  | Readonly<{ status: 'accepted'; actualTokens: number }>
  | Readonly<{
      status: 'rejected';
      reason: SessionCompactionRejectionReason;
      actualTokens?: number;
      cause?: unknown;
    }>;
