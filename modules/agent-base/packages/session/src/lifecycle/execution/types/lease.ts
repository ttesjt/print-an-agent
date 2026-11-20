import type { SessionReference } from '../../../contracts/index.js';

declare const executionBrand: unique symbol;

export type SessionExecutionId = string & { readonly [executionBrand]: 'SessionExecutionId' };

/** Adapter-issued and registered authority. Parsing a value does not grant execution rights. */
export interface SessionExecutionLease extends SessionReference {
  readonly executionId: SessionExecutionId;
}

/** Lifecycle-capable adapters require registered execution authority for every runtime write. */
export interface SessionWriteAuthority {
  readonly execution?: SessionExecutionLease;
}
