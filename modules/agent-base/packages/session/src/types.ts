import type { AgentId } from '@ta-agent/base-identity';
import type { AssistantModelMessage, ModelMessage, UserModelMessage } from '@ta-agent/base-model';

declare const sessionIdBrand: unique symbol;
declare const turnIdBrand: unique symbol;

export type SessionId = string & { readonly [sessionIdBrand]: 'SessionId' };
export type TurnId = string & { readonly [turnIdBrand]: 'TurnId' };

export interface SessionReference {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface ActiveSessionTurn {
  readonly status: 'active';
  readonly turnId: TurnId;
  readonly userMessage: UserModelMessage;
}

export interface CompletedSessionTurn {
  readonly status: 'completed';
  readonly turnId: TurnId;
  readonly userMessage: UserModelMessage;
  readonly assistantMessage: AssistantModelMessage;
}

export interface FailedSessionTurn {
  readonly status: 'failed';
  readonly turnId: TurnId;
  readonly userMessage: UserModelMessage;
  readonly failureCode: string;
}

export type SessionTurn = ActiveSessionTurn | CompletedSessionTurn | FailedSessionTurn;

export interface SessionSnapshot extends SessionReference {
  readonly turns: readonly SessionTurn[];
}

export interface ResolveSessionRequest {
  readonly agentId: AgentId;
  readonly requestedSessionId?: string;
}

export interface BeginSessionTurnRequest extends SessionReference {
  readonly turnId: TurnId;
  readonly userMessage: UserModelMessage;
}

export interface LoadSessionHistoryRequest extends SessionReference {
  readonly beforeTurnId: TurnId;
}

export interface CompleteSessionTurnRequest extends SessionReference {
  readonly turnId: TurnId;
  readonly assistantMessage: AssistantModelMessage;
}

export interface FailSessionTurnRequest extends SessionReference {
  readonly turnId: TurnId;
  readonly failureCode: string;
}

export interface SessionPort {
  resolve(request: ResolveSessionRequest): Promise<SessionReference>;
  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn>;
  loadHistory(request: LoadSessionHistoryRequest): Promise<readonly ModelMessage[]>;
  completeTurn(request: CompleteSessionTurnRequest): Promise<CompletedSessionTurn>;
  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn>;
}

export interface InspectableSessionPort extends SessionPort {
  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined>;
}
