import { expect, it } from 'vitest';
import * as api from '../../src/index.js';
it('preserves the deliberate Standalone runtime API', () => {
  expect(Object.keys(api).sort()).toEqual([
    'AgentBaseStandaloneError',
    'DEFAULT_MEMORY_MEASUREMENT_REF',
    'DEFAULT_SQLITE_MANAGED_NAMESPACE_TABLE_NAMES',
    'STANDALONE_AGENT_CONFIG_CODEC',
    'createSharedSqliteStandaloneDefinition',
    'createSharedSqliteStandaloneManagementService',
    'createSharedSqliteStandaloneRuntimeService',
    'createSharedSqliteStandaloneSessionNavigationService',
    'createSharedSqliteStandaloneSessionService',
    'createSharedSqliteStandaloneSetup',
    'createStandaloneAgent',
    'createStandaloneDirectoryDefinition',
    'createStandaloneDirectoryManagementService',
    'createStandaloneDirectoryRuntimeService',
    'createStandaloneDirectorySessionNavigationService',
    'createStandaloneDirectorySessionService',
    'createStandaloneDirectorySetup',
    'createStandaloneMemorySetup',
    'createStandaloneProviderService',
    'defineStandaloneAgentBootstrapConfig',
    'defineStandaloneAgentConfig',
    'defineStandaloneAgentManifest',
    'encodeStandaloneAgentManifest',
    'materializeStandaloneAgentRuntime',
    'openStandaloneAgent',
    'projectStandaloneSessionNavigationService',
    'resolveSqliteManagedNamespaceTableNames',
  ]);
});
