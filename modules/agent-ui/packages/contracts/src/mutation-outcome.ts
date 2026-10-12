import type { AgentManagementFailure } from './agent-types.js';

/** Only deliberately projected, non-secret diagnostics may cross this boundary. */
export interface MutationNotice {
  readonly code: string;
  readonly message: string;
}

/** A rejected mutation is known not to have committed. Transport loss alone cannot prove this. */
export type MutationOutcome<Value, Failure = AgentManagementFailure> =
  | Readonly<{ status: 'committed'; value: Value; notices: readonly MutationNotice[] }>
  | Readonly<{ status: 'rejected'; failure: Failure }>
  | Readonly<{ status: 'indeterminate'; notice: MutationNotice }>;

export interface RevisionedValue<Value> {
  readonly revision: string;
  readonly value: Value;
}
