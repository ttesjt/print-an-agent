import type {
  ContextModelMessage,
  ModelMessage,
  ProviderModelReference,
} from '@ta-agent/base-model';
import type {
  CompletedSessionTurn,
  InspectableSessionPort,
  SessionReference,
  TurnId,
} from '../types.js';

export interface SessionCompactionPolicy {
  readonly minimumCompletedTurns: number;
  readonly retainRecentTurns: number;
  readonly maxSourceTurns: number;
  readonly maxSourceCharacters: number;
  readonly maxContextCharacters: number;
  readonly timeoutMilliseconds: number;
}

export interface SessionCompaction extends SessionReference {
  readonly revision: number;
  readonly throughTurnId: TurnId;
  readonly context: ContextModelMessage;
}

export interface SessionContextSnapshot extends SessionReference {
  readonly compaction?: SessionCompaction;
  readonly messages: readonly ModelMessage[];
}

export type ReadSessionCompactionRequest = SessionReference;

export interface CommitSessionCompactionRequest extends SessionReference {
  readonly expectedRevision: number;
  readonly throughTurnId: TurnId;
  readonly context: ContextModelMessage;
}

export interface SessionCompactionPort {
  readCompaction(request: ReadSessionCompactionRequest): Promise<SessionCompaction | undefined>;
  commitCompaction(request: CommitSessionCompactionRequest): Promise<SessionCompaction>;
}

export type CompactableSessionPort = InspectableSessionPort & SessionCompactionPort;

export interface SessionCompactionSource extends SessionReference {
  readonly expectedRevision: number;
  readonly previousContext?: ContextModelMessage;
  readonly turns: readonly CompletedSessionTurn[];
  readonly throughTurnId: TurnId;
  readonly sourceCharacters: number;
}

export interface SessionCompactionRuntimeRequest {
  readonly modelReference: ProviderModelReference;
  readonly instructions: string;
  readonly previousContext?: ContextModelMessage;
  readonly turns: readonly CompletedSessionTurn[];
  readonly maxContextCharacters: number;
  readonly signal: AbortSignal;
}

export interface SessionCompactionRuntimeResult {
  readonly text: string;
}

export interface SessionCompactionRuntime {
  compact(request: SessionCompactionRuntimeRequest): Promise<SessionCompactionRuntimeResult>;
}

export interface CompactSessionInput {
  readonly sessionId: string;
}

export type SessionCompactionSkipReason = 'not-needed';

export type SessionCompactionOutcome =
  | Readonly<{
      status: 'skipped';
      sessionId: string;
      reason: SessionCompactionSkipReason;
    }>
  | Readonly<{
      status: 'compacted';
      sessionId: string;
      revision: number;
      throughTurnId: TurnId;
      compactedTurnCount: number;
    }>;
