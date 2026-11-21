import type { ExecutionTimeoutMilliseconds } from '@print-an-agent/workflow-core';

export interface RequestPolicy {
  readonly maxMessageCharacters: number;
  readonly maxInstructionsCharacters: number;
  readonly maxOutputCharacters: number;
  /** Readable reasoning characters across all model turns, including skipped delivery. */
  readonly maxReasoningCharacters: number;
  readonly maxModelTurns: number;
  /** Maximum accepted interaction events, including the event currently being delivered. */
  readonly maxPendingInteractionEvents: number;
  /** Cooperative Request Workflow execution deadline; null adds no local deadline. */
  readonly timeoutMilliseconds: ExecutionTimeoutMilliseconds;
}
