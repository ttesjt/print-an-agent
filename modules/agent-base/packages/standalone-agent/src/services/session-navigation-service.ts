import type {
  SessionBranchForkOutcome,
  SessionBranchRewindOutcome,
  SessionBranchSelectionOutcome,
  SessionNavigationInspectionOutcome,
  SessionNavigationService,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  parseSessionBranchId,
  parseSessionId,
  parseTurnId,
  type SessionNavigationOperationOptions,
} from '@print-an-agent/base-session';

export interface StandaloneSessionNavigationReferenceInput {
  readonly agentId: string;
  readonly sessionId: string;
}

export interface StandaloneSelectSessionBranchInput extends StandaloneSessionNavigationReferenceInput {
  readonly branchId: string;
  readonly expectedRevision: number;
}

export interface StandaloneForkSessionBranchInput extends StandaloneSessionNavigationReferenceInput {
  readonly sourceBranchId: string;
  readonly throughTurnId: string;
  readonly newBranchId?: string;
  readonly expectedRevision: number;
}

export interface StandaloneRewindSessionBranchInput extends StandaloneSessionNavigationReferenceInput {
  readonly throughTurnId: string;
  readonly newBranchId?: string;
  readonly expectedRevision: number;
}

/** String-input projection of the generic out-of-band Session navigation Service. */
export interface StandaloneSessionNavigationService {
  inspect(
    input: StandaloneSessionNavigationReferenceInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionNavigationInspectionOutcome>;
  select(
    input: StandaloneSelectSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchSelectionOutcome>;
  fork(
    input: StandaloneForkSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchForkOutcome>;
  rewind(
    input: StandaloneRewindSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchRewindOutcome>;
}

function projectReference(input: StandaloneSessionNavigationReferenceInput) {
  return Object.freeze({
    agentId: parseAgentId(input.agentId),
    sessionId: parseSessionId(input.sessionId),
  });
}

/** Projects branded generic Session navigation onto a Standalone host/JSON boundary. */
export function projectStandaloneSessionNavigationService(
  service: SessionNavigationService
): StandaloneSessionNavigationService {
  return Object.freeze({
    inspect: (
      input: StandaloneSessionNavigationReferenceInput,
      options?: SessionNavigationOperationOptions
    ) => service.inspect(projectReference(input), options),
    select: (
      input: StandaloneSelectSessionBranchInput,
      options?: SessionNavigationOperationOptions
    ) =>
      service.select(
        {
          ...projectReference(input),
          branchId: parseSessionBranchId(input.branchId),
          expectedRevision: input.expectedRevision,
        },
        options
      ),
    fork: (input: StandaloneForkSessionBranchInput, options?: SessionNavigationOperationOptions) =>
      service.fork(
        {
          ...projectReference(input),
          sourceBranchId: parseSessionBranchId(input.sourceBranchId),
          throughTurnId: parseTurnId(input.throughTurnId),
          ...(input.newBranchId === undefined
            ? {}
            : { newBranchId: parseSessionBranchId(input.newBranchId) }),
          expectedRevision: input.expectedRevision,
        },
        options
      ),
    rewind: (
      input: StandaloneRewindSessionBranchInput,
      options?: SessionNavigationOperationOptions
    ) =>
      service.rewind(
        {
          ...projectReference(input),
          throughTurnId: parseTurnId(input.throughTurnId),
          ...(input.newBranchId === undefined
            ? {}
            : { newBranchId: parseSessionBranchId(input.newBranchId) }),
          expectedRevision: input.expectedRevision,
        },
        options
      ),
  });
}
