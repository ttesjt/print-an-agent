/** Targets refer to the exact persisted context text under the configured tokenizer. */
export type SessionCompactionTarget =
  | Readonly<{
      maxTokens: number;
      limitTokens?: never;
      ratio?: never;
      reserveTokens?: never;
    }>
  | Readonly<{
      maxTokens?: never;
      limitTokens?: number;
      ratio?: number;
      reserveTokens?: number;
    }>;

export const SESSION_COMPACTION_REJECTION_REASON = Object.freeze({
  EMPTY: 'empty',
  TRUNCATED: 'truncated',
  TOKEN_LIMIT: 'token-limit',
  GENERATION_LIMIT: 'generation-limit',
} as const);

export type SessionCompactionRejectionReason =
  (typeof SESSION_COMPACTION_REJECTION_REASON)[keyof typeof SESSION_COMPACTION_REJECTION_REASON];

export interface SessionCompactionFeedback {
  readonly currentTargetTokens: number;
  readonly actualTokens: number;
  readonly targetTokens: number;
  readonly retrySafetyFactor: number;
  readonly minimumTargetTokens: number;
}
