export const SESSION_COMPACTION_REJECTION_REASON = Object.freeze({
  EMPTY: 'empty',
  TRUNCATED: 'truncated',
  TOKEN_LIMIT: 'token-limit',
  GENERATION_LIMIT: 'generation-limit',
} as const);

export type SessionCompactionRejectionReason =
  (typeof SESSION_COMPACTION_REJECTION_REASON)[keyof typeof SESSION_COMPACTION_REJECTION_REASON];
