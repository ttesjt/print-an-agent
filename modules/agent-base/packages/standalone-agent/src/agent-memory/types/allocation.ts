import type { MemoryProvisioningRequest } from '@print-an-agent/base-composition';
import type { ResourceRegistry } from '@print-an-agent/base-composition/resource-registry';
import type { StandaloneSetupCloseOptions } from '../../setup/index.js';
import type { MemoryManagementRecipe } from './provisioning.js';

export interface MemoryProfileAllocation {
  readonly registry: ResourceRegistry;
  readonly recipe: MemoryManagementRecipe;
}

export type MemoryAllocationResolver<N> = (
  namespace: MemoryProvisioningRequest<N, unknown>['namespace']
) => Promise<MemoryProfileAllocation>;

export interface MemoryAllocationOwner<N> {
  assertOpen(this: void): void;
  readonly resolve: MemoryAllocationResolver<N>;
  close(this: void, options?: StandaloneSetupCloseOptions): Promise<void>;
}
