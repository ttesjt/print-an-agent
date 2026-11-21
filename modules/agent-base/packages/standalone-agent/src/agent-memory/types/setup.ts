import type {
  ContextMemoryManagementCapability,
  RetrievalMemoryManagementCapability,
  RuntimeMemorySessionPort,
  SessionContextMemoryCoordinator,
} from '@print-an-agent/base-composition';
import type {
  StandaloneSessionDefinition as BaseDefinition,
  StandaloneSetupCloseOptions,
} from '../../setup/index.js';

export type MemoryManagedStandaloneDefinition<N> = BaseDefinition<N> &
  Partial<ContextMemoryManagementCapability<N> & RetrievalMemoryManagementCapability<N>>;

export interface StandaloneSessionContextMemory {
  resolve(agentId: string): Promise<SessionContextMemoryCoordinator>;
  /** Product Profile supplies its declared Session authority; no adapters are fetched from another Service. */
  bind(
    agentId: string,
    session: RuntimeMemorySessionPort
  ): Promise<SessionContextMemoryCoordinator>;
}

export interface MemorySetupSource<N> {
  readonly definition: BaseDefinition<N>;
  close(options?: StandaloneSetupCloseOptions): Promise<void>;
}

export interface MemorySetupExtension<N> {
  readonly definition: MemoryManagedStandaloneDefinition<N>;
  readonly sessionContextMemory?: StandaloneSessionContextMemory;
  close(options?: StandaloneSetupCloseOptions): Promise<void>;
}
