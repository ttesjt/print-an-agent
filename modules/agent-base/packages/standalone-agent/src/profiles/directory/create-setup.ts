import type { FilesystemAgentResourceNamespace } from './types/namespace.js';
import { join } from 'node:path';
import type {
  StandaloneMemoryManagementOptions,
  MemorySetupExtension,
} from '../../agent-memory/index.js';
import { withStandaloneMemoryManagement } from '../../agent-memory/index.js';
import { reopenableStandaloneSetup } from '../../setup/index.js';
import { createStandaloneDirectoryDefinition } from './create-definition.js';
import type { CreateStandaloneDirectoryProfileOptions } from './types/options.js';

export function createStandaloneDirectorySetup(
  options: CreateStandaloneDirectoryProfileOptions,
  memory?: StandaloneMemoryManagementOptions
): MemorySetupExtension<FilesystemAgentResourceNamespace> {
  return withStandaloneMemoryManagement(
    reopenableStandaloneSetup(createStandaloneDirectoryDefinition(options)),
    memory,
    (namespace) => ({
      key: namespace.handle.databasePath,
      contextPath: join(namespace.handle.directoryPath, 'context-memory.sqlite'),
      retrievalPath: join(namespace.handle.directoryPath, 'retrieval-memory.sqlite'),
    })
  );
}
