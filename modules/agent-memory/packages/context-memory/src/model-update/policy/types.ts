export interface ExecutionPolicy {
  readonly maxConflictRetries: number | null;
  readonly maxCompactionPasses: number | null;
  readonly retrySafetyFactor: number;
  readonly minPlannerTargetTokens: number;
  readonly maxInputTokens: number | null;
  readonly timeoutMs: number | null;
}
