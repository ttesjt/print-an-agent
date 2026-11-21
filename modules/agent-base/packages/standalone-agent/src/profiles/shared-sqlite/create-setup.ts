import type { SharedSqliteAgentResourceNamespace } from './types/namespace.js';
import type {
  StandaloneMemoryManagementOptions,
  MemorySetupExtension,
} from '../../agent-memory/index.js';
import { withStandaloneMemoryManagement } from '../../agent-memory/index.js';
import { reopenableStandaloneSetup } from '../../setup/index.js';
import { createSharedSqliteStandaloneDefinition } from './create-definition.js';
import type { CreateSharedSqliteStandaloneProfileOptions } from './types/options.js';

export function createSharedSqliteStandaloneSetup(
  options: CreateSharedSqliteStandaloneProfileOptions,
  memory?: StandaloneMemoryManagementOptions
): MemorySetupExtension<SharedSqliteAgentResourceNamespace> {
  return withStandaloneMemoryManagement(
    reopenableStandaloneSetup(createSharedSqliteStandaloneDefinition(options)),
    memory,
    (namespace) => ({
      key: JSON.stringify([namespace.handle.databasePath, namespace.agentId]),
      contextPath: `${namespace.handle.databasePath}.context-memory.sqlite`,
      retrievalPath: `${namespace.handle.databasePath}.retrieval-memory.sqlite`,
    })
  );
}
