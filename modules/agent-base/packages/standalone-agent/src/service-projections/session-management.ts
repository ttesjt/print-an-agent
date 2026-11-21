import type { SessionManagementService } from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { parseSessionId, parseTurnId } from '@print-an-agent/base-session';
import { projectSessionReference } from './session-reference.js';
import type { StandaloneSessionManagementService } from './types/session-management.js';

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
