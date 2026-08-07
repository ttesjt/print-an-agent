import { randomUUID } from 'node:crypto';
import type { AgentId } from '@ta-agent/base-identity';
import type { ModelMessage } from '@ta-agent/base-model';
import { AgentSessionError } from '../errors.js';
import { parseSessionFailureCode, parseSessionId } from '../identifiers.js';
import type {
  ActiveSessionTurn,
  BeginSessionTurnRequest,
  CompleteSessionTurnRequest,
  CompletedSessionTurn,
  FailSessionTurnRequest,
  InspectableSessionPort,
  LoadSessionHistoryRequest,
  ResolveSessionRequest,
  SessionId,
  SessionReference,
  SessionSnapshot,
  SessionTurn,
} from '../types.js';

interface StoredSession {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly turns: SessionTurn[];
}

function sessionKey(agentId: AgentId, sessionId: SessionId): string {
  return `${agentId}\u0000${sessionId}`;
}

function cloneTurn(turn: ActiveSessionTurn): ActiveSessionTurn;
function cloneTurn(turn: CompletedSessionTurn): CompletedSessionTurn;
function cloneTurn(turn: SessionTurn): SessionTurn;
function cloneTurn(turn: SessionTurn): SessionTurn {
  if (turn.status === 'completed') {
    return Object.freeze({
      ...turn,
      userMessage: Object.freeze({ ...turn.userMessage }),
      assistantMessage: Object.freeze({
        ...turn.assistantMessage,
        usage: Object.freeze({ ...turn.assistantMessage.usage }),
      }),
    });
  }
  return Object.freeze({ ...turn, userMessage: Object.freeze({ ...turn.userMessage }) });
}

export class MemorySessionAdapter implements InspectableSessionPort {
  readonly #sessions = new Map<string, StoredSession>();
  readonly #createSessionId: () => string;

  constructor(createSessionId: () => string = randomUUID) {
    this.#createSessionId = createSessionId;
  }

  resolve(request: ResolveSessionRequest): Promise<SessionReference> {
    return Promise.resolve().then(() => {
      const sessionId = parseSessionId(request.requestedSessionId ?? this.#createSessionId());
      const key = sessionKey(request.agentId, sessionId);
      if (!this.#sessions.has(key)) {
        this.#sessions.set(key, { agentId: request.agentId, sessionId, turns: [] });
      }
      return Object.freeze({ agentId: request.agentId, sessionId });
    });
  }

  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      if (session.turns.some((turn) => turn.turnId === request.turnId)) {
        throw new AgentSessionError(
          'TURN_ALREADY_EXISTS',
          `Turn "${request.turnId}" already exists in session "${request.sessionId}".`
        );
      }
      const turn: ActiveSessionTurn = Object.freeze({
        status: 'active',
        turnId: request.turnId,
        userMessage: Object.freeze({ ...request.userMessage }),
      });
      session.turns.push(turn);
      return cloneTurn(turn);
    });
  }

  loadHistory(request: LoadSessionHistoryRequest): Promise<readonly ModelMessage[]> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      const beforeIndex = session.turns.findIndex((turn) => turn.turnId === request.beforeTurnId);
      if (beforeIndex < 0) {
        throw new AgentSessionError(
          'TURN_NOT_FOUND',
          `Turn "${request.beforeTurnId}" does not exist in session "${request.sessionId}".`
        );
      }
      const messages = session.turns.slice(0, beforeIndex).flatMap<ModelMessage>((turn) =>
        turn.status === 'completed'
          ? [
              Object.freeze({ ...turn.userMessage }),
              Object.freeze({
                ...turn.assistantMessage,
                usage: Object.freeze({ ...turn.assistantMessage.usage }),
              }),
            ]
          : []
      );
      return Object.freeze(messages);
    });
  }

  completeTurn(request: CompleteSessionTurnRequest): Promise<CompletedSessionTurn> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      const index = this.#requireTurnIndex(session, request.turnId);
      const current = session.turns[index];
      if (current?.status !== 'active') {
        throw new AgentSessionError(
          'TURN_STATE_INVALID',
          `Turn "${request.turnId}" cannot complete from state "${current?.status ?? 'missing'}".`
        );
      }
      const completed: CompletedSessionTurn = Object.freeze({
        status: 'completed',
        turnId: current.turnId,
        userMessage: current.userMessage,
        assistantMessage: Object.freeze({
          ...request.assistantMessage,
          usage: Object.freeze({ ...request.assistantMessage.usage }),
        }),
      });
      session.turns[index] = completed;
      return cloneTurn(completed);
    });
  }

  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn> {
    return Promise.resolve().then(() => {
      const failureCode = parseSessionFailureCode(request.failureCode);
      const session = this.#requireSession(request);
      const index = this.#requireTurnIndex(session, request.turnId);
      const current = session.turns[index];
      if (current === undefined) {
        throw new AgentSessionError('TURN_NOT_FOUND', `Turn "${request.turnId}" does not exist.`);
      }
      if (current.status !== 'active') return cloneTurn(current);

      const failed: SessionTurn = Object.freeze({
        status: 'failed',
        turnId: current.turnId,
        userMessage: current.userMessage,
        failureCode,
      });
      session.turns[index] = failed;
      return cloneTurn(failed);
    });
  }

  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const session = this.#sessions.get(sessionKey(reference.agentId, reference.sessionId));
      if (session === undefined) return undefined;
      return Object.freeze({
        agentId: session.agentId,
        sessionId: session.sessionId,
        turns: Object.freeze(session.turns.map(cloneTurn)),
      });
    });
  }

  #requireSession(reference: SessionReference): StoredSession {
    const session = this.#sessions.get(sessionKey(reference.agentId, reference.sessionId));
    if (session === undefined) {
      throw new AgentSessionError(
        'SESSION_NOT_FOUND',
        `Session "${reference.sessionId}" does not exist for agent "${reference.agentId}".`
      );
    }
    return session;
  }

  #requireTurnIndex(session: StoredSession, turnId: string): number {
    const index = session.turns.findIndex((turn) => turn.turnId === turnId);
    if (index < 0) {
      throw new AgentSessionError(
        'TURN_NOT_FOUND',
        `Turn "${turnId}" does not exist in session "${session.sessionId}".`
      );
    }
    return index;
  }
}
