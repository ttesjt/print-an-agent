import type { StandaloneMemoryManagementOptions } from '../../resources/agent-memory/contracts.js';
import { withStandaloneMemoryManagement } from '../../resources/agent-memory/setup.js';
import { reopenableStandaloneSetup } from '../../setup/index.js';
import { createSharedSqliteStandaloneDefinition } from './create-definition.js';
import type { CreateSharedSqliteStandaloneProfileOptions } from './types/options.js';

export function createSharedSqliteStandaloneSetup(
  options: CreateSharedSqliteStandaloneProfileOptions,
  memory?: StandaloneMemoryManagementOptions
) {
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
