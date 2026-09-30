import type { SessionManagementService } from '@ta-agent/base-composition';
import { parseAgentId } from '@ta-agent/base-identity';
import {
  parseSessionId,
  parseTurnId,
  type RetiredSessionListPage,
  type SessionExecutionFence,
  type SessionLifecycleInspection,
  type SessionLifecycleListPage,
  type SessionLifecycleSnapshot,
  type SessionTurnPage,
} from '@ta-agent/base-session';

export interface StandaloneSessionReferenceInput {
  readonly agentId: string;
  readonly sessionId: string;
}

export interface StandaloneListSessionsInput {
  readonly agentId: string;
  readonly cursor?: Readonly<{ readonly updatedAt: number; readonly sessionId: string }>;
  readonly limit?: number;
}

export interface StandaloneListRetiredSessionsInput {
  readonly agentId: string;
  readonly cursor?: Readonly<{ readonly retiredAt: number; readonly sessionId: string }>;
  readonly limit?: number;
}

export interface StandaloneListSessionTurnsInput extends StandaloneSessionReferenceInput {
  readonly beforeTurnId?: string;
  readonly limit?: number;
}

export interface StandaloneSessionLifecycleMutationInput extends StandaloneSessionReferenceInput {
  readonly expectedRevision: number;
}

export interface StandalonePurgeSessionInput extends StandaloneSessionLifecycleMutationInput {
  readonly confirmation: 'permanently-delete-session';
}

export interface StandaloneRecoverSessionExecutionsInput extends StandaloneSessionReferenceInput {
  readonly expectedExecutionRevision: number;
}

/** String/JSON boundary projection of the generic, branded Session management Service. */
export interface StandaloneSessionManagementService {
  list(input: StandaloneListSessionsInput): Promise<SessionLifecycleListPage>;
  listRetired(input: StandaloneListRetiredSessionsInput): Promise<RetiredSessionListPage>;
  inspect(input: StandaloneSessionReferenceInput): Promise<SessionLifecycleInspection | undefined>;
  listTurns(input: StandaloneListSessionTurnsInput): Promise<SessionTurnPage | undefined>;
  retire(input: StandaloneSessionLifecycleMutationInput): Promise<SessionLifecycleSnapshot>;
  restore(input: StandaloneSessionLifecycleMutationInput): Promise<SessionLifecycleSnapshot>;
  purge(input: StandalonePurgeSessionInput): Promise<void>;
  recover(input: StandaloneRecoverSessionExecutionsInput): Promise<SessionExecutionFence>;
}

function projectReference(input: StandaloneSessionReferenceInput) {
  return Object.freeze({
    agentId: parseAgentId(input.agentId),
    sessionId: parseSessionId(input.sessionId),
  });
}

/** Projects branded generic Session management onto the Standalone host/JSON boundary. */
export function projectStandaloneSessionManagementService(
  service: SessionManagementService
): StandaloneSessionManagementService {
  return Object.freeze({
    list: (input: StandaloneListSessionsInput) =>
      service.list({
        agentId: parseAgentId(input.agentId),
        ...(input.cursor === undefined
          ? {}
          : {
              cursor: {
                updatedAt: input.cursor.updatedAt,
                sessionId: parseSessionId(input.cursor.sessionId),
              },
            }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    listRetired: (input: StandaloneListRetiredSessionsInput) =>
      service.listRetired({
        agentId: parseAgentId(input.agentId),
        ...(input.cursor === undefined
          ? {}
          : {
              cursor: {
                retiredAt: input.cursor.retiredAt,
                sessionId: parseSessionId(input.cursor.sessionId),
              },
            }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    inspect: (input: StandaloneSessionReferenceInput) => service.inspect(projectReference(input)),
    listTurns: (input: StandaloneListSessionTurnsInput) =>
      service.listTurns({
        ...projectReference(input),
        ...(input.beforeTurnId === undefined
          ? {}
          : { beforeTurnId: parseTurnId(input.beforeTurnId) }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    retire: (input: StandaloneSessionLifecycleMutationInput) =>
      service.retire({ ...projectReference(input), expectedRevision: input.expectedRevision }),
    restore: (input: StandaloneSessionLifecycleMutationInput) =>
      service.restore({ ...projectReference(input), expectedRevision: input.expectedRevision }),
    purge: (input: StandalonePurgeSessionInput) =>
      service.purge({
        ...projectReference(input),
        expectedRevision: input.expectedRevision,
        confirmation: input.confirmation,
      }),
    recover: (input: StandaloneRecoverSessionExecutionsInput) =>
      service.recover({
        ...projectReference(input),
        expectedExecutionRevision: input.expectedExecutionRevision,
      }),
  });
}
