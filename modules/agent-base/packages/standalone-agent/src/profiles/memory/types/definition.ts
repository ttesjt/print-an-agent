import type {
  MemoryManagedStandaloneDefinition,
  StandaloneSessionContextMemory,
} from '../../../agent-memory/index.js';
import type { StandaloneSessionDefinition, StandaloneSetup } from '../../../setup/index.js';
import type { MemoryAgentResourceNamespace } from './namespace.js';

export type StandaloneMemoryDefinition = StandaloneSessionDefinition<MemoryAgentResourceNamespace>;

export interface StandaloneMemorySetup extends StandaloneSetup<MemoryAgentResourceNamespace> {
  readonly definition: MemoryManagedStandaloneDefinition<MemoryAgentResourceNamespace>;
  readonly sessionContextMemory?: StandaloneSessionContextMemory;
}
