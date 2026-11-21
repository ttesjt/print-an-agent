import type { ManagedAgentAuthorityPorts } from '@print-an-agent/base-composition';
import type { ResourceAcquisition } from '@print-an-agent/base-composition/resource-registry';
import type { CoordinatedSessionPersistence } from '@print-an-agent/base-local-adapters';

interface MemoryAcquisitionInput {
  readonly agentId: string;
  readonly allocationId: string;
  readonly signal: AbortSignal;
}

/** Prepared during stage; allocation authority and release stay owned by the Profile Scope. */
export type MemoryAuthorityFactory = (
  input: MemoryAcquisitionInput
) =>
  | ResourceAcquisition<ManagedAgentAuthorityPorts>
  | Promise<ResourceAcquisition<ManagedAgentAuthorityPorts>>;

/** A concrete Profile recipe, not a generic Service dependency or run-time provider override. */
export type MemorySessionPersistenceFactory = (
  input: MemoryAcquisitionInput
) =>
  | ResourceAcquisition<CoordinatedSessionPersistence>
  | Promise<ResourceAcquisition<CoordinatedSessionPersistence>>;
