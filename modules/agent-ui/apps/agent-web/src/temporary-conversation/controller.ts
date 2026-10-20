import type { ConversationReasoningBlock, ConversationUserMessage } from '@ta-agent/ui-contracts';
import {
  TEMPORARY_EVENT as E,
  type TemporaryConversationPort,
  type TemporaryConversationRequest,
} from './contracts.js';
import {
  TemporaryStreamProtocol,
  isTemporaryTerminal,
  type TemporaryTerminalEvent,
} from './protocol.js';
import { parseTemporaryRequest, TEMPORARY_LIMITS } from './validation.js';
import { integer } from '@ta-agent/ui-transport';

export interface TemporaryTarget {
  readonly agentId: string;
  readonly displayName: string;
  readonly configRevision: string;
}
export interface TemporaryTurn {
  readonly id: string;
  readonly user: ConversationUserMessage;
  readonly text: string;
  readonly reasoning: readonly ConversationReasoningBlock[];
  readonly status: 'submitting' | 'streaming' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
  readonly failure?: string;
}
export interface TemporaryConversationState {
  readonly open: boolean;
  readonly generation: number;
  readonly target: TemporaryTarget | undefined;
  readonly pendingTarget: TemporaryTarget | undefined;
  readonly turns: readonly TemporaryTurn[];
  readonly draft: string;
  readonly busy: boolean;
  readonly blocked: boolean;
  readonly notice: string | undefined;
}
interface Operation {
  readonly input: TemporaryConversationRequest;
  readonly generation: number;
  readonly controller: AbortController;
}
const MAX_VISIBLE_ATTEMPTS = 128;
function empty(generation: number): TemporaryConversationState {
  return Object.freeze({
    open: false,
    generation,
    turns: Object.freeze([]),
    draft: '',
    busy: false,
    blocked: false,
    target: undefined,
    pendingTarget: undefined,
    notice: undefined,
  });
}

/** Collection-owned application state; neither a backend Session nor a runtime execution owner. */
export class TemporaryConversationController {
  readonly #port: TemporaryConversationPort;
  readonly #createId: () => string;
  readonly #historyLimit: number;
  readonly #attemptLimit: number;
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Set<Promise<void>>();
  #state = empty(0);
  #active: Operation | undefined;

  constructor(
    port: TemporaryConversationPort,
    options: Readonly<{
      createId?: () => string;
      maxHistoryTurns?: number;
      maxVisibleAttempts?: number;
    }> = {}
  ) {
    this.#port = port;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#historyLimit = integer(1, TEMPORARY_LIMITS.maxHistoryTurns).decode(
      options.maxHistoryTurns ?? TEMPORARY_LIMITS.maxHistoryTurns
    );
    this.#attemptLimit = integer(1, MAX_VISIBLE_ATTEMPTS).decode(
      options.maxVisibleAttempts ?? MAX_VISIBLE_ATTEMPTS
    );
  }
  readonly getSnapshot = (): TemporaryConversationState => this.#state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(patch: Partial<TemporaryConversationState>): void {
    this.#state = Object.freeze({ ...this.#state, ...patch });
    for (const listener of this.#listeners) listener();
  }
  #turn(id: string, patch: Partial<TemporaryTurn>): void {
    this.#publish({
      turns: Object.freeze(
        this.#state.turns.map((turn) =>
          turn.id === id ? Object.freeze({ ...turn, ...patch }) : turn
        )
      ),
    });
  }
  open(target: TemporaryTarget): void {
    const previous = this.#state.target;
    const changed =
      previous !== undefined &&
      (previous.agentId !== target.agentId || previous.configRevision !== target.configRevision);
    if (changed && (this.#state.turns.length > 0 || this.#state.draft.length > 0)) {
      this.#publish({ pendingTarget: Object.freeze({ ...target }) });
      return;
    }
    this.#publish({ open: true, target: Object.freeze({ ...target }), pendingTarget: undefined });
  }
  dismissReset(): void {
    this.#publish({ pendingTarget: undefined });
  }
  confirmReset(): void {
    const target = this.#state.pendingTarget;
    if (target === undefined) return;
    this.clear();
    this.open(target);
  }
  setDraft(draft: string): void {
    if (!this.#state.busy) this.#publish({ draft });
  }
  cancel(): void {
    if (this.#active === undefined) return;
    this.#turn(this.#active.input.interactionId, { status: 'cancelling' });
    this.#active.controller.abort(new DOMException('Temporary response cancelled.', 'AbortError'));
  }
  /** Visibility is independent of the Collection-owned interaction lifecycle. */
  close(): void {
    this.#publish({ open: false });
  }
  clear(): void {
    const target = this.#state.target;
    const open = this.#state.open;
    const generation = this.#state.generation + 1;
    const active = this.#active;
    this.#active = undefined;
    this.#state = empty(generation);
    active?.controller.abort(new DOMException('Temporary conversation cleared.', 'AbortError'));
    this.#publish({ open, ...(target === undefined ? {} : { target }) });
  }
  /** Cleanup is replay-safe for React StrictMode; old operations are invalidated, not reused. */
  async dispose(): Promise<void> {
    this.clear();
    this.#publish({ open: false, target: undefined });
    await Promise.allSettled(this.#pending);
  }
  send(): Promise<void> {
    const target = this.#state.target;
    if (
      !this.#state.open ||
      target === undefined ||
      this.#active !== undefined ||
      this.#state.blocked
    )
      return Promise.resolve();
    const completed = this.#state.turns.filter((turn) => turn.status === 'completed');
    if (completed.length >= this.#historyLimit || this.#state.turns.length >= this.#attemptLimit) {
      this.#publish({ notice: 'Temporary history is full. Clear it to continue.', blocked: true });
      return Promise.resolve();
    }
    let input: TemporaryConversationRequest;
    try {
      input = parseTemporaryRequest({
        interactionId: this.#createId(),
        agentId: target.agentId,
        expectedConfigRevision: target.configRevision,
        message: this.#state.draft,
        history: completed.map((turn) => ({ user: turn.user.text, assistant: turn.text })),
      });
    } catch {
      this.#publish({
        notice: 'The message or history exceeds the temporary conversation limits.',
      });
      return Promise.resolve();
    }
    const operation: Operation = {
      input,
      generation: this.#state.generation,
      controller: new AbortController(),
    };
    this.#active = operation;
    this.#publish({
      busy: true,
      draft: '',
      notice: undefined,
      turns: Object.freeze([
        ...this.#state.turns,
        Object.freeze({
          id: input.interactionId,
          user: Object.freeze({ text: input.message, timestamp: new Date().toISOString() }),
          text: '',
          reasoning: Object.freeze([]),
          status: 'submitting' as const,
        }),
      ]),
    });
    const work = this.#execute(operation);
    this.#pending.add(work);
    void work.then(
      () => {
        this.#pending.delete(work);
      },
      () => {
        this.#pending.delete(work);
      }
    );
    return work;
  }
  #current(operation: Operation): boolean {
    return this.#active === operation && this.#state.generation === operation.generation;
  }
  async #execute(operation: Operation): Promise<void> {
    const protocol = new TemporaryStreamProtocol(operation.input);
    const text: string[] = [];
    const reasoning: string[] = [];
    let terminal: TemporaryTerminalEvent | undefined;
    const id = operation.input.interactionId;
    try {
      await this.#port.streamTemporaryConversation(
        { ...operation.input, signal: operation.controller.signal },
        (event) => {
          if (!this.#current(operation)) return Promise.resolve();
          operation.controller.signal.throwIfAborted();
          const value = protocol.accept(event);
          if (isTemporaryTerminal(value)) terminal = value;
          else if (value.type === E.OPENED) this.#turn(id, { status: 'streaming' });
          else {
            (value.type === E.TEXT ? text : reasoning).push(value.delta);
            const content = reasoning.join('');
            this.#turn(id, {
              text: text.join(''),
              reasoning: Object.freeze(
                content.length === 0 ? [] : [Object.freeze({ modelTurnIndex: 1, text: content })]
              ),
            });
          }
          return Promise.resolve();
        }
      );
      if (!this.#current(operation)) return;
      operation.controller.signal.throwIfAborted();
      protocol.finish();
      if (terminal?.type === E.COMPLETED)
        this.#turn(id, {
          status: 'completed',
          text: terminal.assistant.text,
          reasoning: terminal.assistant.reasoningBlocks,
        });
      else if (terminal?.type === E.CANCELLED) this.#turn(id, { status: 'cancelled' });
      else if (terminal?.type === E.FAILED) {
        this.#turn(id, {
          status: 'failed',
          failure: `${terminal.failure.message} (${terminal.failure.code})`,
        });
        if (
          ['TEMPORARY_CONFIG_CONFLICT', 'TEMPORARY_TARGET_DISABLED'].includes(terminal.failure.code)
        )
          this.#publish({
            blocked: true,
            notice:
              'The selected configuration changed or is unavailable. Clear and reload to continue.',
          });
      }
    } catch {
      if (!this.#current(operation)) return;
      this.#turn(
        id,
        operation.controller.signal.aborted
          ? { status: 'cancelled' }
          : { status: 'failed', failure: 'The temporary stream did not complete successfully.' }
      );
    } finally {
      if (this.#current(operation)) {
        this.#active = undefined;
        this.#publish({ busy: false });
      }
    }
  }
}
