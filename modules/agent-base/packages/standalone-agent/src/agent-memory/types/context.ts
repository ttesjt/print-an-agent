import type {
  ContextMemoryToolScope,
  createContextMemoryTools,
} from '@print-an-agent/base-composition';
import type { ResourceAcquisition } from '@print-an-agent/base-composition/resource-registry';
import type {
  MemoryMutationResources,
  MemoryStore,
  MemoryWorkflowDefinitions,
  VersionedMemoryWorkflowDefinitions,
} from '@print-an-agent/context-memory';
import type {
  MemoryCapabilityAcquirer,
  MemoryStorageAcquisition,
  MemoryTextCounter,
} from './acquisition.js';

export interface StandaloneContextMemoryOptions {
  /** Explicit runtime installation; management installation alone never enables Agent memory. */
  readonly runtime?: Readonly<{
    readonly enabled?: (agentId: string) => boolean;
    readonly writable?: boolean;
    /** Explicit tool ceiling; custom tool factories must opt in their names here. */
    readonly toolAllowList?: readonly string[];
    readonly createTools?: (
      scope: ContextMemoryToolScope
    ) => ReturnType<typeof createContextMemoryTools>;
    readonly workflows?: Partial<VersionedMemoryWorkflowDefinitions>;
  }>;
  readonly defaults?: MemoryMutationResources['defaults'];
  readonly acquireCounter?: MemoryCapabilityAcquirer<MemoryTextCounter>;
  /** Optional external root. No release means borrowed; a supplied release owns only that acquisition. */
  readonly acquireStore?: (
    input: MemoryStorageAcquisition
  ) => ResourceAcquisition<MemoryStore> | Promise<ResourceAcquisition<MemoryStore>>;
  readonly workflows?: Partial<MemoryWorkflowDefinitions>;
}
