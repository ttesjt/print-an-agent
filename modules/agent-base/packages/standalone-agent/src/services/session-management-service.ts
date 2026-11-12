import type {
  ManagementOperationOptions,
  SessionManagementService,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity';
import {
  parseSessionId,
  parseTurnId,
  type RetiredSessionListPage,
  type SessionExecutionFence,
  type SessionLifecycleInspection,
  type SessionLifecycleListPage,
  type SessionLifecycleSnapshot,
  type SessionTurnPage,
} from '@print-an-agent/base-session';

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
  list(
    input: StandaloneListSessionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleListPage>;
  listRetired(
    input: StandaloneListRetiredSessionsInput,
    options?: ManagementOperationOptions
  ): Promise<RetiredSessionListPage>;
  inspect(
    input: StandaloneSessionReferenceInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleInspection | undefined>;
  listTurns(
    input: StandaloneListSessionTurnsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionTurnPage | undefined>;
  retire(
    input: StandaloneSessionLifecycleMutationInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleSnapshot>;
  restore(
    input: StandaloneSessionLifecycleMutationInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleSnapshot>;
  purge(input: StandalonePurgeSessionInput, options?: ManagementOperationOptions): Promise<void>;
  recover(
    input: StandaloneRecoverSessionExecutionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionExecutionFence>;
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
  const projected: StandaloneSessionManagementService = {
    list: (input, options) =>
      service.list(
        {
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
        },
        options
      ),
    listRetired: (input, options) =>
      service.listRetired(
        {
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
        },
        options
      ),
    inspect: (input, options) => service.inspect(projectReference(input), options),
    listTurns: (input, options) =>
      service.listTurns(
        {
          ...projectReference(input),
          ...(input.beforeTurnId === undefined
            ? {}
            : { beforeTurnId: parseTurnId(input.beforeTurnId) }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
        options
      ),
    retire: (input, options) =>
      service.retire(
        { ...projectReference(input), expectedRevision: input.expectedRevision },
        options
      ),
    restore: (input, options) =>
      service.restore(
        { ...projectReference(input), expectedRevision: input.expectedRevision },
        options
      ),
    purge: (input, options) =>
      service.purge(
        {
          ...projectReference(input),
          expectedRevision: input.expectedRevision,
          confirmation: input.confirmation,
        },
        options
      ),
    recover: (input, options) =>
      service.recover(
        {
          ...projectReference(input),
          expectedExecutionRevision: input.expectedExecutionRevision,
        },
        options
      ),
  };
  return Object.freeze(projected);
}
