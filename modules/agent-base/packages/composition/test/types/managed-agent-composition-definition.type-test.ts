import type { AgentConfigCodec } from '@ta-agent/base-config';
import { parseAgentId, type AgentIdentityCatalogPort } from '@ta-agent/base-identity';
import { parseSessionId } from '@ta-agent/base-session';
import type {
  Agent,
  AgentOperationDefinitionMap,
  AgentOperationReference,
} from '@ta-agent/base-workflow';
import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  defineManagedAgentComposition,
  type AgentConfigProjectionPort,
  type ManagedAgentAuthorityPorts,
  type ManagedAgentDefinitionConfig,
  type ManagedAgentDefinitionRuntimePorts,
  type ManagedAgentNamespace,
  type ManagedAgentNamespacePort,
  type ManagedAgentRuntimeMaterializationInput,
  type MaterializedManagedAgent,
  type SessionManagementCapability,
  type SessionManagementPorts,
  type StagedManagedAgentNamespace,
} from '../../src/index.js';

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

interface CustomConfig {
  readonly model: string;
}

interface NamespaceHandle {
  readonly tenantId: string;
}

interface RuntimePorts {
  readonly providerToken: string;
}

interface AgentResources {
  readonly productResource: string;
}

type CustomOperations = Readonly<{
  custom: Readonly<{
    exposure: 'public';
    reference: AgentOperationReference<'custom', Readonly<{ query: string }>, string>;
  }>;
}>;

declare const codec: AgentConfigCodec<CustomConfig>;
declare const namespacePort: ManagedAgentNamespacePort<NamespaceHandle>;
declare const identityCatalog: AgentIdentityCatalogPort;
declare const authorityPorts: ManagedAgentAuthorityPorts;
interface ProductAgent extends Agent<AgentResources, CustomOperations> {
  readonly productKind: 'product';
  productMethod(): 'product-result';
}

declare const rawAgent: ProductAgent;
declare const projectionPort: AgentConfigProjectionPort<NamespaceHandle, CustomConfig>;

const definition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: {
    createPorts: (namespace) => {
      void namespace.handle.tenantId;
      return authorityPorts;
    },
  },
  runtime: {
    createPorts: (namespace): RuntimePorts => {
      void namespace.handle.tenantId;
      return { providerToken: 'provider' };
    },
    materialize: (input: ManagedAgentRuntimeMaterializationInput<CustomConfig, RuntimePorts>) => {
      void input.identity;
      void input.config.model;
      void input.ports.providerToken;
      // @ts-expect-error Namespace handles must not cross the runtime materializer boundary.
      void input.namespace;
      return rawAgent;
    },
  },
  projection: { port: projectionPort },
});

void definition;

export type ConfigIsPreserved = Expect<
  Equal<ManagedAgentDefinitionConfig<typeof definition>, CustomConfig>
>;
export type RuntimePortsArePreserved = Expect<
  Equal<ManagedAgentDefinitionRuntimePorts<typeof definition>, RuntimePorts>
>;
export type NamespaceHandleIsPreserved = Expect<
  Equal<
    NonNullable<Awaited<ReturnType<(typeof definition)['namespace']['port']['resolve']>>>['handle'],
    NamespaceHandle
  >
>;
export type RawAgentIsPreserved = Expect<
  Equal<MaterializedManagedAgent<typeof definition>, ProductAgent>
>;
export type CustomCatalogIsPreserved = Expect<
  Equal<MaterializedManagedAgent<typeof definition>['operations'], CustomOperations>
>;
export type ProductAgentMemberIsPreserved = Expect<
  Equal<MaterializedManagedAgent<typeof definition>['productKind'], 'product'>
>;
export type ProjectionPublishUsesPublishedNamespace = Expect<
  Equal<
    Parameters<NonNullable<(typeof definition)['projection']>['port']['publish']>[0],
    ManagedAgentNamespace<NamespaceHandle>
  >
>;
export type ProjectionReconcileUsesPublishedNamespace = Expect<
  Equal<
    Parameters<NonNullable<(typeof definition)['projection']>['port']['reconcile']>[0],
    ManagedAgentNamespace<NamespaceHandle>
  >
>;
export type StagedNamespaceIsNotPublished = Expect<
  Equal<
    StagedManagedAgentNamespace<NamespaceHandle> extends ManagedAgentNamespace<NamespaceHandle>
      ? true
      : false,
    false
  >
>;
export type PublishedNamespaceIsNotStaged = Expect<
  Equal<
    ManagedAgentNamespace<NamespaceHandle> extends StagedManagedAgentNamespace<NamespaceHandle>
      ? true
      : false,
    false
  >
>;
export type CoreDefinitionHasNoSessionCapability = Expect<
  Equal<'sessionManagement' extends keyof typeof definition ? true : false, false>
>;

const management = createAgentManagementService(definition);
void management;

const managedAgentId = parseAgentId('managed-agent');
const runtimeService = createAgentRuntimeService(definition);
const openedProductAgent = runtimeService.open(managedAgentId);
void openedProductAgent;

export type RuntimeServicePreservesProductAgent = Expect<
  Equal<Awaited<typeof openedProductAgent>, ProductAgent>
>;

// @ts-expect-error Generic runtime opening accepts a branded Agent ID.
void runtimeService.open('managed-agent');

// @ts-expect-error Core Definitions do not silently gain standard Session management.
createSessionManagementService(definition);

void management.inspect(managedAgentId);
void management.updateConfig({
  agentId: managedAgentId,
  config: { model: 'test-model' },
  expectedRevision: 1,
});
void management.importConfig({
  agentId: managedAgentId,
  input: { model: 'imported-model' },
  expectedRevision: 1,
});

// @ts-expect-error Generic management accepts branded Agent IDs after creation.
void management.inspect('managed-agent');

void management.updateConfig({
  agentId: managedAgentId,
  // @ts-expect-error Typed Config updates preserve the Definition Config type.
  config: { provider: 'wrong-shape' },
  expectedRevision: 1,
});

const sessionDefinition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  sessionManagement: {
    createPorts: () => ({ sessionToken: 'session' as const }),
  },
});

void sessionDefinition;

export type SessionCapabilityIsPreserved = Expect<
  Equal<
    typeof sessionDefinition extends SessionManagementCapability<
      NamespaceHandle,
      Readonly<{ sessionToken: 'session' }>
    >
      ? true
      : false,
    true
  >
>;

// @ts-expect-error A product-owned capability is not the standard Session management contract.
createSessionManagementService(sessionDefinition);

declare const sessionManagementPorts: SessionManagementPorts;
const standardSessionDefinition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  sessionManagement: {
    createPorts: (): Promise<SessionManagementPorts> => Promise.resolve(sessionManagementPorts),
  },
});

const sessionService = createSessionManagementService(standardSessionDefinition);
const managedSessionId = parseSessionId('managed-session');
void sessionService.inspect({ agentId: managedAgentId, sessionId: managedSessionId });
void sessionService.list({ agentId: managedAgentId });

// @ts-expect-error Generic Session management accepts branded Agent IDs.
void sessionService.list({ agentId: 'managed-agent' });

// @ts-expect-error Generic Session management accepts branded Session IDs.
void sessionService.inspect({ agentId: managedAgentId, sessionId: 'managed-session' });

const sessionRuntime = createAgentRuntimeService(standardSessionDefinition).open(managedAgentId);
void sessionRuntime;
export type SessionCapabilityPreservesProductAgent = Expect<
  Equal<Awaited<typeof sessionRuntime>, ProductAgent>
>;

const asyncRuntimePortsDefinition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): Promise<RuntimePorts> => Promise.resolve({ providerToken: 'async-provider' }),
    materialize: (
      input: ManagedAgentRuntimeMaterializationInput<CustomConfig, RuntimePorts>
    ): ProductAgent => {
      void input.ports.providerToken;
      return rawAgent;
    },
  },
});

export type AsyncRuntimePortsAreAwaited = Expect<
  Equal<ManagedAgentDefinitionRuntimePorts<typeof asyncRuntimePortsDefinition>, RuntimePorts>
>;
const asyncRuntimeService = createAgentRuntimeService(asyncRuntimePortsDefinition);
const asyncOpenedProductAgent = asyncRuntimeService.open(managedAgentId);
void asyncOpenedProductAgent;
export type AsyncRuntimeServicePreservesProductAgent = Expect<
  Equal<Awaited<typeof asyncOpenedProductAgent>, ProductAgent>
>;

declare const facade: Readonly<{ invoke(name: string): Promise<unknown> }>;

// @ts-expect-error A runtime materializer must return the actual Agent class, not a facade.
defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => ({ identityCatalog, config: authorityPorts.config }) },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => facade,
  },
});

export type OperationsSatisfyDefinitionMap = Expect<
  CustomOperations extends AgentOperationDefinitionMap ? true : false
>;

export {};
