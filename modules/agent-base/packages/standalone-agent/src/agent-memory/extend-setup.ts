import {
  defineManagedAgentComposition,
  type ManagedAgentNamespaceReference,
} from '@print-an-agent/base-composition';
import { createMemoryAllocationOwner } from './allocation-owner.js';
import { contextMemoryProvisioning } from './context/provisioning.js';
import { snapshotMemoryManagementOptions } from './options.js';
import { retrievalMemoryProvisioning } from './retrieval/provisioning.js';
import { createRuntimeMemoryIntegration } from './runtime/extend-definition.js';
import { RuntimeMemoryLifetime } from './runtime/lifetime.js';
import type { StandaloneMemoryManagementOptions } from './types/options.js';
import type { MemorySetupExtension, MemorySetupSource } from './types/setup.js';
import type { AgentMemoryStorageBinding } from './types/storage.js';

/** Adds optional product capabilities while the original Profile remains authority/runtime owner. */
export function withStandaloneMemoryManagement<N>(
  source: MemorySetupSource<N>,
  input: StandaloneMemoryManagementOptions | undefined,
  storage: (namespace: ManagedAgentNamespaceReference<N>) => AgentMemoryStorageBinding
): MemorySetupExtension<N> {
  if (input === undefined) return source;
  const options = snapshotMemoryManagementOptions(input);
  const runtimeLifetime = new RuntimeMemoryLifetime();
  const owner = createMemoryAllocationOwner(source, options, storage, runtimeLifetime);
  const allocation = owner.resolve;
  const { runtime, sessionNavigation, sessionManagement, sessionContextMemory } =
    createRuntimeMemoryIntegration(
      source.definition,
      options,
      allocation,
      runtimeLifetime,
      owner.assertOpen
    );
  const port = source.definition.namespace.port;
  const definition = defineManagedAgentComposition({
    ...source.definition,
    runtime,
    sessionNavigation,
    sessionManagement,
    namespace: {
      port: {
        stage: (id) => {
          owner.assertOpen();
          return port.stage(id);
        },
        publish: (namespace) => {
          owner.assertOpen();
          return port.publish(namespace);
        },
        resolve: (id) => {
          owner.assertOpen();
          return port.resolve(id);
        },
        list: () => {
          owner.assertOpen();
          return port.list();
        },
        abort: async (namespace) => {
          owner.assertOpen();
          // Memory resolution requires published authority. A staged allocation therefore has
          // no Memory acquisitions; a stale abort must never close a published allocation's Scope.
          await port.abort(namespace);
        },
      },
    },
    ...(options.context === undefined
      ? {}
      : { contextMemoryManagement: contextMemoryProvisioning(options, allocation) }),
    ...(options.retrieval === undefined
      ? {}
      : { retrievalMemoryManagement: retrievalMemoryProvisioning(options, allocation) }),
  });

  return Object.freeze({
    definition,
    ...(sessionContextMemory === undefined ? {} : { sessionContextMemory }),
    close: owner.close,
  });
}
