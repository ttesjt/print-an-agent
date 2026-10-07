import type {
  CompletedConversationTurn,
  ConversationFailure,
  ConversationToolActivity,
} from './conversation-types.js';
import type {
  SessionDetails,
  SessionNavigationSnapshot,
  SessionRevision,
} from './session-types.js';

/** Authoritative Session identity available before the model response finishes. */
export interface ConversationSessionAdmission {
  readonly details: SessionDetails;
  readonly navigation: SessionNavigationSnapshot;
}

export interface ExistingConversationTarget {
  readonly branchId: string;
  readonly navigationRevision: SessionRevision;
  readonly sessionId: string;
}

export interface StartConversationInteractionInput {
  readonly agentId: string;
  readonly interactionId: string;
  readonly message: string;
  readonly session?: ExistingConversationTarget;
  readonly signal?: AbortSignal;
}

interface ConversationInteractionEventBase {
  readonly interactionId: string;
}

export type ConversationInteractionEvent =
  | Readonly<ConversationInteractionEventBase & { readonly type: 'interaction-started' }>
  | Readonly<
      ConversationInteractionEventBase & {
        readonly admission: ConversationSessionAdmission;
        readonly type: 'session-admitted';
      }
    >
  | Readonly<
      ConversationInteractionEventBase & {
        readonly delta: string;
        readonly modelTurnIndex: number;
        readonly type: 'reasoning-delta';
      }
    >
  | Readonly<
      ConversationInteractionEventBase & {
        readonly delta: string;
        readonly modelTurnIndex: number;
        readonly type: 'text-delta';
      }
    >
  | Readonly<
      ConversationInteractionEventBase & {
        readonly activity: ConversationToolActivity;
        readonly type: 'tool-activity-updated';
      }
    >
  | Readonly<
      ConversationInteractionEventBase & {
        readonly sessionId: string;
        readonly turn: CompletedConversationTurn;
        readonly type: 'completed';
      }
    >
  | Readonly<
      ConversationInteractionEventBase & {
        readonly failure: ConversationFailure;
        readonly type: 'failed';
      }
    >
  | Readonly<ConversationInteractionEventBase & { readonly type: 'cancelled' }>;

export type ConversationInteractionEventConsumer = (
  event: ConversationInteractionEvent
) => Promise<void>;

export interface ConversationInteractionPort {
  /** Resolves only after exactly one terminal event has been accepted by the consumer. */
  streamInteraction(
    input: StartConversationInteractionInput,
    consume: ConversationInteractionEventConsumer
  ): Promise<void>;
}
