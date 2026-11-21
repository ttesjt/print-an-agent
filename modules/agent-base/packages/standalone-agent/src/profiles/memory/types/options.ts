import type { StandaloneRuntimeOptions } from '../../../runtime/index.js';
import type { MemoryProvisioningOptions } from './provisioning.js';

export interface CreateStandaloneMemoryProfileOptions
  extends StandaloneRuntimeOptions, MemoryProvisioningOptions {}
