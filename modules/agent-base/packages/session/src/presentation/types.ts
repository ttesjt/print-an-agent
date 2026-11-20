import type {
  CompletedSessionTurn,
  SessionBranchId,
  SessionReference,
  TurnId,
} from '../contracts/index.js';
import type { CompleteSessionTurnRequest } from '../turns/index.js';

/** Display-only readable content; never an input ModelMessage. */
export interface SessionReasoningBlock {
  /** One-based model invocation ordinal within this Session turn; gaps are allowed. */
  readonly modelTurnIndex: number;
  readonly text: string;
}

export interface SessionTurnPresentation {
  readonly reasoningBlocks: readonly SessionReasoningBlock[];
}

export interface SessionTurnPresentationReference extends SessionReference {
  readonly turnId: TurnId;
}

export interface SessionTurnPresentationRecord extends SessionTurnPresentationReference {
  readonly branchId: SessionBranchId;
  readonly presentation: SessionTurnPresentation;
}

export interface CompleteSessionTurnWithPresentationRequest extends CompleteSessionTurnRequest {
  readonly presentation: SessionTurnPresentation;
}

/** Optional capability on the same Session adapter, not an independent sidecar writer. */
export interface SessionPresentationPort {
  /** Atomically commits the completed turn, branch head, and presentation, or commits none. */
  completeTurnWithPresentation(
    request: CompleteSessionTurnWithPresentationRequest
  ): Promise<CompletedSessionTurn>;
  /** Exact bounded lookup; missing turns or turns without presentation return undefined. */
  readTurnPresentation(
    reference: SessionTurnPresentationReference
  ): Promise<SessionTurnPresentationRecord | undefined>;
}
