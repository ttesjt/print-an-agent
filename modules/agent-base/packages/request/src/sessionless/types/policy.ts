export interface SessionlessGenerationPolicy {
  readonly maxMessageCharacters: number;
  /** Text characters across history, external context and the current message; not a token count. */
  readonly maxContextCharacters: number;
  /** Includes the current user message; bounds structural overhead even for empty history text. */
  readonly maxContextMessages: number;
  readonly maxInstructionsCharacters: number;
  readonly maxOutputCharacters: number;
  readonly maxReasoningCharacters: number;
  readonly maxPendingInteractionEvents: number;
}

/** Shared limits retain their established public identity. */
export type SessionlessPolicy = SessionlessGenerationPolicy;
