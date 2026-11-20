import type { SessionReference } from '../../contracts/index.js';

export type SessionLifecycleState =
  | Readonly<{ status: 'active' }>
  | Readonly<{ status: 'retired'; retiredAt: number }>;

export type SessionLifecycleSnapshot = SessionReference &
  SessionLifecycleState &
  Readonly<{ metadataRevision: number; metadataUpdatedAt: number }>;

/** Also required by lifecycle-aware metadata writes, including rename. */
export interface SessionLifecycleMutationInput extends SessionReference {
  readonly expectedRevision: number;
}
