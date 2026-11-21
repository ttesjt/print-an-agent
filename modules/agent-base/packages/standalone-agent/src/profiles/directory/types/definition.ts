import type { StandaloneSessionDefinition } from '../../../setup/index.js';
import type { FilesystemAgentResourceNamespace } from './namespace.js';

export type StandaloneDirectoryDefinition =
  StandaloneSessionDefinition<FilesystemAgentResourceNamespace>;
