import type { AgentConfigCodec, ConfigValue } from '@print-an-agent/base-identity-config/config';
import {
  MemoryAgentConfigAdapter,
  MemoryAgentIdentityCatalogAdapter,
} from '@print-an-agent/base-local-adapters';
import { parseAgentId, type AgentId } from '@print-an-agent/base-identity-config/identity';
import { createAgent, type Agent } from '@print-an-agent/base-runtime';
import { vi } from 'vitest';
import {
  defineManagedAgentComposition,
  type AgentConfigProjectionPort,
  type AgentConfigProjectionView,
  ManagedAgentNamespaceError,
  type ManagedAgentAuthorityPorts,
  type ManagedAgentCompositionDefinition,
  type ManagedAgentNamespace,
  type ManagedAgentNamespacePort,
  type ManagedAgentRuntimeMaterializationInput,
  type ManagedAgentRuntimeMaterializer,
  type ManagedAgentRuntimePortFactory,
  type ManagedAgentRuntimeProvisioningInput,
  type StagedManagedAgentNamespace,
} from '../../src/index.js';

export interface TestManagedAgentConfig {
  readonly label: string;
}

interface TestNamespaceHandle {
  readonly slot: number;
}

interface TestRuntimePorts {
  readonly slot: number;
}

interface TestAgentResources {
  readonly label: string;
  readonly slot: number;
}

type TestOperations = Readonly<Record<never, never>>;
type TestAgent = Agent<Readonly<TestAgentResources>, TestOperations>;

interface TestAuthorityResources extends ManagedAgentAuthorityPorts {
  readonly identityCatalog: MemoryAgentIdentityCatalogAdapter;
  readonly config: MemoryAgentConfigAdapter;
}

export interface ManagedAgentFixtureControls {
  abortFailure: Error | undefined;
  namespacePublishFailure: Error | undefined;
  projectionPublishFailure: Error | undefined;
  projectionReconcileFailure: Error | undefined;
  projectionStatus: 'current' | 'stale';
  listedNamespaces: readonly ManagedAgentNamespace<TestNamespaceHandle>[] | undefined;
  runtimePortsFailure: Error | undefined;
  materializationFailure: Error | undefined;
  materializedValueOverride: Readonly<{ value: unknown }> | undefined;
}

export interface ManagedAgentFixture {
  readonly codec: AgentConfigCodec<TestManagedAgentConfig>;
  readonly definition: ReturnType<typeof createDefinition>;
  readonly controls: ManagedAgentFixtureControls;
  readonly events: string[];
  readonly namespacePort: ManagedAgentNamespacePort<TestNamespaceHandle>;
  readonly projectionPublish: ReturnType<typeof vi.fn>;
  readonly projectionReconcile: ReturnType<typeof vi.fn>;
  readonly createRuntimePorts: ReturnType<typeof vi.fn>;
  readonly materialize: ReturnType<typeof vi.fn>;
  authorityFor(agentId: AgentId): TestAuthorityResources;
  stage(agentId: AgentId): Promise<StagedManagedAgentNamespace<TestNamespaceHandle>>;
}

function defineConfig(value: unknown): TestManagedAgentConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Config must be an object.');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Reflect.ownKeys(record).length !== 1 ||
    !Object.hasOwn(record, 'label') ||
    typeof record.label !== 'string' ||
    record.label.length === 0
  ) {
    throw new Error('Config must contain only a non-empty label.');
  }
  return Object.freeze({ label: record.label });
}

function createDefinition(
  codec: AgentConfigCodec<TestManagedAgentConfig>,
  namespacePort: ManagedAgentNamespacePort<TestNamespaceHandle>,
  createAuthorityPorts: (namespace: {
    readonly handle: TestNamespaceHandle;
  }) => ManagedAgentAuthorityPorts,
  createRuntimePorts: ManagedAgentRuntimePortFactory<
    TestManagedAgentConfig,
    TestNamespaceHandle,
    TestRuntimePorts
  >,
  materialize: ManagedAgentRuntimeMaterializer<TestManagedAgentConfig, TestRuntimePorts, TestAgent>,
  projectionPort?: AgentConfigProjectionPort<TestNamespaceHandle, TestManagedAgentConfig>
): ManagedAgentCompositionDefinition<
  TestManagedAgentConfig,
  TestNamespaceHandle,
  TestRuntimePorts,
  TestAgent
> {
  const input = {
    config: { codec },
    namespace: { port: namespacePort },
    authority: { createPorts: createAuthorityPorts },
    runtime: { createPorts: createRuntimePorts, materialize },
  };
  return projectionPort === undefined
    ? defineManagedAgentComposition(input)
    : defineManagedAgentComposition({ ...input, projection: { port: projectionPort } });
}

export function createManagedAgentFixture(options: { readonly projection?: boolean } = {}) {
  const controls: ManagedAgentFixtureControls = {
    abortFailure: undefined,
    namespacePublishFailure: undefined,
    projectionPublishFailure: undefined,
    projectionReconcileFailure: undefined,
    projectionStatus: 'current',
    listedNamespaces: undefined,
    runtimePortsFailure: undefined,
    materializationFailure: undefined,
    materializedValueOverride: undefined,
  };
  const events: string[] = [];
  const staged = new Map<AgentId, StagedManagedAgentNamespace<TestNamespaceHandle>>();
  const published = new Map<AgentId, ManagedAgentNamespace<TestNamespaceHandle>>();
  const resources = new Map<number, TestAuthorityResources>();
  let nextSlot = 0;

  const codec: AgentConfigCodec<TestManagedAgentConfig> = Object.freeze({
    schemaVersion: 1,
    decode: defineConfig,
    encode: (config: TestManagedAgentConfig): ConfigValue => ({ label: config.label }),
  });

  const namespacePort: ManagedAgentNamespacePort<TestNamespaceHandle> = {
    stage: (agentIdInput) => {
      const agentId = parseAgentId(agentIdInput);
      events.push(`namespace:stage:${agentId}`);
      if (published.has(agentId)) {
        return Promise.reject(
          new ManagedAgentNamespaceError(
            'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
            'Agent namespace already exists at /private/namespace/path.'
          )
        );
      }
      const existing = staged.get(agentId);
      if (existing !== undefined) {
        return Promise.resolve(Object.freeze({ ...existing, resumed: true }));
      }
      const handle = Object.freeze({ slot: ++nextSlot });
      const namespace = Object.freeze({
        agentId,
        handle,
        phase: 'staged' as const,
        resumed: false,
      });
      staged.set(agentId, namespace);
      resources.set(
        handle.slot,
        Object.freeze({
          identityCatalog: new MemoryAgentIdentityCatalogAdapter({ clock: () => handle.slot }),
          config: new MemoryAgentConfigAdapter(),
        })
      );
      return Promise.resolve(namespace);
    },
    publish: (namespace) => {
      events.push(`namespace:publish:${namespace.agentId}`);
      if (controls.namespacePublishFailure !== undefined) {
        return Promise.reject(controls.namespacePublishFailure);
      }
      const result = Object.freeze({
        agentId: namespace.agentId,
        handle: namespace.handle,
        phase: 'published' as const,
      });
      staged.delete(namespace.agentId);
      published.set(namespace.agentId, result);
      return Promise.resolve(result);
    },
    abort: (namespace) => {
      events.push(`namespace:abort:${namespace.agentId}`);
      if (controls.abortFailure !== undefined) return Promise.reject(controls.abortFailure);
      staged.delete(namespace.agentId);
      resources.delete(namespace.handle.slot);
      return Promise.resolve();
    },
    resolve: (agentId) => Promise.resolve(published.get(agentId)),
    list: () =>
      Promise.resolve(controls.listedNamespaces ?? Object.freeze([...published.values()])),
  };

  const authorityFor = (agentId: AgentId): TestAuthorityResources => {
    const namespace = staged.get(agentId) ?? published.get(agentId);
    if (namespace === undefined) throw new Error('Test namespace does not exist.');
    const authority = resources.get(namespace.handle.slot);
    if (authority === undefined) throw new Error('Test authority does not exist.');
    return authority;
  };
  const createAuthorityPorts = (namespace: { readonly handle: TestNamespaceHandle }) => {
    events.push(`authority:ports:${String(namespace.handle.slot)}`);
    const authority = resources.get(namespace.handle.slot);
    if (authority === undefined) throw new Error('Test authority does not exist.');
    return authority;
  };
  const createRuntimePorts = vi.fn(
    ({
      namespace,
    }: ManagedAgentRuntimeProvisioningInput<
      TestManagedAgentConfig,
      TestNamespaceHandle
    >): Promise<TestRuntimePorts> => {
      events.push(`runtime:ports:${String(namespace.handle.slot)}`);
      if (controls.runtimePortsFailure !== undefined) {
        return Promise.reject(controls.runtimePortsFailure);
      }
      return Promise.resolve(Object.freeze({ slot: namespace.handle.slot }));
    }
  );
  const materialize = vi.fn(
    (
      input: ManagedAgentRuntimeMaterializationInput<TestManagedAgentConfig, TestRuntimePorts>
    ): TestAgent => {
      events.push(
        `runtime:materialize:${input.identity.id}:${input.config.label}:${String(input.ports.slot)}`
      );
      if (controls.materializationFailure !== undefined) throw controls.materializationFailure;
      if (controls.materializedValueOverride !== undefined) {
        return controls.materializedValueOverride.value as TestAgent;
      }
      return createAgent<Readonly<TestAgentResources>, TestOperations>({
        identity: input.identity,
        resources: Object.freeze({ label: input.config.label, slot: input.ports.slot }),
        operations: Object.freeze({}),
      });
    }
  );
  const projectionPublish = vi.fn(
    (
      namespace: ManagedAgentNamespace<TestNamespaceHandle>,
      _view: AgentConfigProjectionView<TestManagedAgentConfig>
    ) => {
      events.push(`projection:publish:${namespace.agentId}`);
      if (controls.projectionPublishFailure !== undefined) {
        return Promise.reject(controls.projectionPublishFailure);
      }
      return Promise.resolve();
    }
  );
  const projectionReconcile = vi.fn(
    (
      namespace: ManagedAgentNamespace<TestNamespaceHandle>,
      _view: AgentConfigProjectionView<TestManagedAgentConfig>
    ) => {
      events.push(`projection:reconcile:${namespace.agentId}`);
      if (controls.projectionReconcileFailure !== undefined) {
        return Promise.reject(controls.projectionReconcileFailure);
      }
      return Promise.resolve(Object.freeze({ kind: controls.projectionStatus }));
    }
  );
  const projectionPort: AgentConfigProjectionPort<TestNamespaceHandle, TestManagedAgentConfig> = {
    publish: projectionPublish,
    reconcile: projectionReconcile,
  };
  const definition = createDefinition(
    codec,
    namespacePort,
    createAuthorityPorts,
    createRuntimePorts,
    materialize,
    options.projection === false ? undefined : projectionPort
  );

  return Object.freeze({
    codec,
    definition,
    controls,
    events,
    namespacePort,
    projectionPublish,
    projectionReconcile,
    createRuntimePorts,
    materialize,
    authorityFor,
    stage: (agentId: AgentId) => namespacePort.stage(agentId),
  });
}
