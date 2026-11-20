import type { SessionNavigationOperationOptions } from '@print-an-agent/base-session';
import type {
  ForkManagedSessionBranchInput,
  InspectManagedSessionNavigationInput,
  RewindManagedSessionBranchInput,
  SelectManagedSessionBranchInput,
} from './input.js';
import type {
  SessionBranchForkOutcome,
  SessionBranchRewindOutcome,
  SessionBranchSelectionOutcome,
  SessionNavigationInspectionOutcome,
} from './outcome.js';

/** Out-of-band Session branch navigation without Agent runtime materialization. */
export interface SessionNavigationService {
  inspect(
    input: InspectManagedSessionNavigationInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionNavigationInspectionOutcome>;
  select(
    input: SelectManagedSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchSelectionOutcome>;
  fork(
    input: ForkManagedSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchForkOutcome>;
  rewind(
    input: RewindManagedSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchRewindOutcome>;
}
