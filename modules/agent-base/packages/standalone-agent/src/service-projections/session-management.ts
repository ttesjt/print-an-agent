import type {
  ManagementOperationOptions,
  SessionManagementService,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
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
import { projectSessionReference } from './session-reference.js';
import type {
  StandaloneListRetiredSessionsInput,
  StandaloneListSessionsInput,
  StandaloneListSessionTurnsInput,
  StandalonePurgeSessionInput,
  StandaloneRecoverSessionExecutionsInput,
  StandaloneSessionLifecycleMutationInput,
} from './types/session-management.js';
import type { StandaloneSessionReferenceInput } from './types/session-reference.js';

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
    inspect: (input, options) => service.inspect(projectSessionReference(input), options),
    listTurns: (input, options) =>
      service.listTurns(
        {
          ...projectSessionReference(input),
          ...(input.beforeTurnId === undefined
            ? {}
            : { beforeTurnId: parseTurnId(input.beforeTurnId) }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
        options
      ),
    retire: (input, options) =>
      service.retire(
        { ...projectSessionReference(input), expectedRevision: input.expectedRevision },
        options
      ),
    restore: (input, options) =>
      service.restore(
        { ...projectSessionReference(input), expectedRevision: input.expectedRevision },
        options
      ),
    purge: (input, options) =>
      service.purge(
        {
          ...projectSessionReference(input),
          expectedRevision: input.expectedRevision,
          confirmation: input.confirmation,
        },
        options
      ),
    recover: (input, options) =>
      service.recover(
        {
          ...projectSessionReference(input),
          expectedExecutionRevision: input.expectedExecutionRevision,
        },
        options
      ),
  };
  return Object.freeze(projected);
}
