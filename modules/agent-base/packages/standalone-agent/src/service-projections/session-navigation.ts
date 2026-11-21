import type {
  SessionBranchForkOutcome,
  SessionBranchRewindOutcome,
  SessionBranchSelectionOutcome,
  SessionNavigationInspectionOutcome,
  SessionNavigationService,
} from '@print-an-agent/base-composition';
import {
  parseSessionBranchId,
  parseTurnId,
  type SessionNavigationOperationOptions,
} from '@print-an-agent/base-session';
import { projectSessionReference } from './session-reference.js';
import type {
  StandaloneForkSessionBranchInput,
  StandaloneRewindSessionBranchInput,
  StandaloneSelectSessionBranchInput,
  StandaloneSessionNavigationReferenceInput,
} from './types/session-navigation.js';

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

/** Projects branded generic Session navigation onto a Standalone host/JSON boundary. */
export function projectStandaloneSessionNavigationService(
  service: SessionNavigationService
): StandaloneSessionNavigationService {
  return Object.freeze({
    inspect: (
      input: StandaloneSessionNavigationReferenceInput,
      options?: SessionNavigationOperationOptions
    ) => service.inspect(projectSessionReference(input), options),
    select: (
      input: StandaloneSelectSessionBranchInput,
      options?: SessionNavigationOperationOptions
    ) =>
      service.select(
        {
          ...projectSessionReference(input),
          branchId: parseSessionBranchId(input.branchId),
          expectedRevision: input.expectedRevision,
        },
        options
      ),
    fork: (input: StandaloneForkSessionBranchInput, options?: SessionNavigationOperationOptions) =>
      service.fork(
        {
          ...projectSessionReference(input),
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
          ...projectSessionReference(input),
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
