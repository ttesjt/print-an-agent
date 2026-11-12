import {
  array,
  object,
  literal,
  union,
  text,
  integer,
  schemas,
  fail,
  type Decoder,
} from '@print-an-agent/ui-transport';
import {
  TEMPORARY_EVENT as E,
  type TemporaryConversationEvent,
  type TemporaryConversationRequest,
} from './contracts.js';
import { TEMPORARY_LIMITS as L } from './validation.js';

const correlated = { interactionId: schemas.id };
const event: Decoder<TemporaryConversationEvent> = union(
  object({ ...correlated, type: literal(E.OPENED) }),
  object({ ...correlated, type: literal(E.TEXT), delta: text(L.maxOutputCharacters) }),
  object({ ...correlated, type: literal(E.REASONING), delta: text(L.maxReasoningCharacters) }),
  object({
    ...correlated,
    type: literal(E.COMPLETED),
    configRevision: schemas.revision,
    assistant: object({
      text: text(L.maxOutputCharacters),
      timestamp: schemas.timestamp,
      stopReason: union(literal('stop'), literal('length')),
      reasoningBlocks: array(
        object({ modelTurnIndex: integer(1, 1), text: text(L.maxReasoningCharacters, 1) }),
        1
      ),
    }),
  }),
  object({
    ...correlated,
    type: literal(E.FAILED),
    failure: object({ code: text(128, 1), message: text(1024, 1) }),
  }),
  object({ ...correlated, type: literal(E.CANCELLED) })
);
export type TemporaryTerminalEvent = Extract<
  TemporaryConversationEvent,
  { type: typeof E.COMPLETED | typeof E.FAILED | typeof E.CANCELLED }
>;
export function isTemporaryTerminal(
  value: TemporaryConversationEvent
): value is TemporaryTerminalEvent {
  return value.type === E.COMPLETED || value.type === E.FAILED || value.type === E.CANCELLED;
}

/** Presentation protocol, not a second Actor protocol. Shared by HTTP and direct UI consumers. */
export class TemporaryStreamProtocol {
  readonly #request: TemporaryConversationRequest;
  readonly #text: string[] = [];
  readonly #reasoning: string[] = [];
  #textCharacters = 0;
  #reasoningCharacters = 0;
  #opened = false;
  #terminal = false;
  #failure: { cause: unknown } | undefined;
  constructor(request: TemporaryConversationRequest) {
    this.#request = request;
  }
  accept(input: unknown): TemporaryConversationEvent {
    if (this.#failure !== undefined) throw this.#failure.cause;
    try {
      return this.#accept(event.decode(input));
    } catch (cause: unknown) {
      this.#failure = { cause };
      throw cause;
    }
  }
  #accept(value: TemporaryConversationEvent): TemporaryConversationEvent {
    if (
      this.#terminal ||
      value.interactionId !== this.#request.interactionId ||
      (!this.#opened && value.type !== E.OPENED) ||
      (this.#opened && value.type === E.OPENED)
    )
      return fail();
    this.#opened = true;
    if (value.type === E.TEXT) {
      this.#text.push(value.delta);
      this.#textCharacters += value.delta.length;
    }
    if (value.type === E.REASONING) {
      this.#reasoning.push(value.delta);
      this.#reasoningCharacters += value.delta.length;
    }
    if (
      this.#textCharacters > L.maxOutputCharacters ||
      this.#reasoningCharacters > L.maxReasoningCharacters
    )
      return fail();
    if (
      value.type === E.COMPLETED &&
      (value.configRevision !== this.#request.expectedConfigRevision ||
        (this.#text.length > 0 && value.assistant.text !== this.#text.join('')) ||
        value.assistant.reasoningBlocks.map((block) => block.text).join('') !==
          this.#reasoning.join(''))
    )
      return fail();
    this.#terminal = isTemporaryTerminal(value);
    return value;
  }
  finish(): void {
    if (this.#failure !== undefined) throw this.#failure.cause;
    if (!this.#terminal) return fail();
  }
}
