import type { StandaloneMemoryManagementOptions } from '@print-an-agent/base-standalone-agent';
import type { MemoryCapabilities } from '../../memory/contracts.js';

/** Host chooses implementations and the safe descriptions advertised to this Collection's UI. */
export interface WebMemoryOptions {
  readonly provisioning: StandaloneMemoryManagementOptions;
  readonly contextBindings?: NonNullable<MemoryCapabilities['context']>['bindings'];
  readonly retrievalBindings?: NonNullable<MemoryCapabilities['retrieval']>['bindings'];
  readonly embeddings?: NonNullable<MemoryCapabilities['retrieval']>['embeddings'];
}
