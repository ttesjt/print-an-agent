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
