export { withStandaloneMemoryManagement } from './extend-setup.js';

export type {
  MemoryCapabilityAcquirer,
  MemoryStorageAcquisition,
  MemoryTextCounter,
} from './types/acquisition.js';

export type { StandaloneContextMemoryOptions } from './types/context.js';

export type { StandaloneRetrievalMemoryOptions } from './types/retrieval.js';

export type { StandaloneMemoryManagementOptions } from './types/options.js';

export type { AgentMemoryStorageBinding } from './types/storage.js';

export type {
  MemoryManagedStandaloneDefinition,
  MemorySetupExtension,
  StandaloneSessionContextMemory,
} from './types/setup.js';

export { DEFAULT_MEMORY_MEASUREMENT_REF } from './provisioning/recipe.js';
