import type { StandaloneSessionDefinition } from '../../../setup/index.js';
import type { SharedSqliteAgentResourceNamespace } from './namespace.js';

export type SharedSqliteStandaloneDefinition =
  StandaloneSessionDefinition<SharedSqliteAgentResourceNamespace>;
