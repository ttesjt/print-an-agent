import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  parseSessionBranchId,
  parseSessionId,
  parseTurnId,
  type ApplySessionNavigationRequest,
  type BeginSessionTurnRequest,
  type SessionBranchReference,
  type SessionReference,
} from '@print-an-agent/base-session';

export function normalizeResolvedReference(
  request: BeginSessionTurnRequest
): BeginSessionTurnRequest {
  return Object.freeze({
    agentId: parseAgentId(request.agentId),
    sessionId: parseSessionId(request.sessionId),
    branchId: parseSessionBranchId(request.branchId),
    navigationRevision: request.navigationRevision,
    turnId: parseTurnId(request.turnId),
    userMessage: request.userMessage,
  });
}

export function normalizeBranchReference(
  reference: SessionBranchReference
): SessionBranchReference {
  return Object.freeze({
    ...normalizeReference(reference),
    branchId: parseSessionBranchId(reference.branchId),
  });
}

export function normalizeNavigationRequest(
  request: ApplySessionNavigationRequest
): ApplySessionNavigationRequest {
  const reference = normalizeReference(request);
  const command = request.command;
  if (command.operation === 'select') {
    return Object.freeze({
      ...reference,
      command: Object.freeze({
        ...command,
        branchId: parseSessionBranchId(command.branchId),
      }),
    });
  }
  if (command.operation === 'fork') {
    return Object.freeze({
      ...reference,
      command: Object.freeze({
        ...command,
        sourceBranchId: parseSessionBranchId(command.sourceBranchId),
        throughTurnId: parseTurnId(command.throughTurnId),
        ...(command.newBranchId === undefined
          ? {}
          : { newBranchId: parseSessionBranchId(command.newBranchId) }),
      }),
    });
  }
  return Object.freeze({
    ...reference,
    command: Object.freeze({
      ...command,
      throughTurnId: parseTurnId(command.throughTurnId),
      ...(command.newBranchId === undefined
        ? {}
        : { newBranchId: parseSessionBranchId(command.newBranchId) }),
    }),
  });
}

export function normalizeReference(reference: SessionReference): SessionReference {
  return Object.freeze({
    agentId: parseAgentId(reference.agentId),
    sessionId: parseSessionId(reference.sessionId),
  });
}
