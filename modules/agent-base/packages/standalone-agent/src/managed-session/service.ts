import { parseAgentId } from '@ta-agent/base-identity';
import { parseSessionId } from '@ta-agent/base-session';
import { AgentBaseStandaloneError } from '../errors.js';
import type {
  CreateManagedStandaloneSessionServiceOptions,
  ManagedSessionReference,
  ManagedStandaloneSessionPorts,
  ManagedStandaloneSessionService,
} from './contracts.js';

function sessionReference(reference: ManagedSessionReference) {
  return Object.freeze({
    agentId: parseAgentId(reference.agentId),
    sessionId: parseSessionId(reference.sessionId),
  });
}

export function createManagedStandaloneSessionService<TNamespace>(
  options: CreateManagedStandaloneSessionServiceOptions<TNamespace>
): ManagedStandaloneSessionService {
  async function withPorts<T>(
    requestedAgentId: string,
    action: (ports: ManagedStandaloneSessionPorts) => Promise<T>
  ): Promise<T> {
    const agentId = parseAgentId(requestedAgentId);
    const namespace = await options.namespaces.resolve(agentId);
    if (namespace === undefined) {
      throw new AgentBaseStandaloneError('Managed Standalone Agent does not exist.', {
        code: 'STANDALONE_AGENT_NOT_FOUND',
      });
    }
    if (namespace.agentId !== agentId) {
      throw new AgentBaseStandaloneError(
        'Agent resource namespace returned authority for a different Agent ID.',
        { code: 'STANDALONE_AGENT_STORAGE_INVALID' }
      );
    }
    return action(options.ports.createSessionManagementPorts(namespace));
  }

  return Object.freeze({
    list: (input) => {
      const request = Object.freeze({ ...input, agentId: parseAgentId(input.agentId) });
      return withPorts(request.agentId, (ports) => ports.session.listSessions(request));
    },
    listRetired: (input) => {
      const request = Object.freeze({ ...input, agentId: parseAgentId(input.agentId) });
      return withPorts(request.agentId, (ports) => ports.session.listRetiredSessions(request));
    },
    inspect: (input) => {
      const reference = sessionReference(input);
      return withPorts(reference.agentId, (ports) => ports.session.inspectSession(reference));
    },
    listTurns: (input) => {
      const request = Object.freeze({ ...input, ...sessionReference(input) });
      return withPorts(request.agentId, (ports) => ports.session.listSessionTurns(request));
    },
    retire: (input) => {
      const request = Object.freeze({
        ...sessionReference(input),
        expectedRevision: input.expectedRevision,
      });
      return withPorts(request.agentId, (ports) => ports.session.retireSession(request));
    },
    restore: (input) => {
      const request = Object.freeze({
        ...sessionReference(input),
        expectedRevision: input.expectedRevision,
      });
      return withPorts(request.agentId, (ports) => ports.session.restoreSession(request));
    },
    purge: (input) => {
      const request = Object.freeze({
        ...sessionReference(input),
        expectedRevision: input.expectedRevision,
        confirmation: input.confirmation,
      });
      return withPorts(request.agentId, (ports) =>
        ports.maintenance.purgeSessionPersistence(request)
      );
    },
    recover: (input) => {
      const request = Object.freeze({
        ...sessionReference(input),
        expectedExecutionRevision: input.expectedExecutionRevision,
      });
      return withPorts(request.agentId, (ports) =>
        ports.maintenance.recoverSessionPersistence(request)
      );
    },
  } satisfies ManagedStandaloneSessionService);
}
