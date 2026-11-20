import type { AgentConfigCodec } from '@print-an-agent/base-identity-config/config';
import {
  parseAgentId,
  type AgentIdentityCatalogPort,
  type AgentIdentitySnapshot,
} from '@print-an-agent/base-identity-config/identity';
import { parseSessionId } from '@print-an-agent/base-session';
import type {
  Agent,
  AgentOperationDefinitionMap,
  AgentOperationReference,
} from '@print-an-agent/base-runtime';
import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
  createContextMemoryManagementService,
  createRetrievalMemoryManagementService,
  defineManagedAgentComposition,
  type AgentConfigProjectionPort,
  type ManagedAgentAuthorityPorts,
  type ManagedAgentCompositionCapabilitiesInput,
  type ManagedAgentCompositionDefinitionInput,
  type ManagedAgentConfigSnapshot,
  type ManagedAgentDefinitionConfig,
  type ManagedAgentDefinitionRuntimePorts,
  type ManagedAgentNamespace,
  type ManagedAgentNamespacePort,
  type ManagedAgentRuntimeMaterializationInput,
  type ManagedAgentRuntimePortFactory,
  type ManagedAgentRuntimeProvisioningInput,
  type MaterializedManagedAgent,
  type SessionManagementCapability,
  type SessionManagementPorts,
  type SessionNavigationAgentCompositionDefinition,
  type SessionNavigationCapability,
  type SessionNavigationPorts,
  type StagedManagedAgentNamespace,
} from '../../src/index.js';

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const contextCapability: import('../../src/index.js').ContextMemoryManagementCapability<NamespaceHandle>;
declare const retrievalCapability: import('../../src/index.js').RetrievalMemoryManagementCapability<NamespaceHandle>;

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
    createPorts: ({ namespace, identity, config }): RuntimePorts => {
      void namespace.handle.tenantId;
      void identity.identity.id;
      void identity.revision;
      void config.revision;
      void config.value.model;
      // @ts-expect-error Provisioning receives the typed Config snapshot, not arbitrary config.
      void config.value.provider;
      return { providerToken: 'provider' };
    },
    materialize: (input: ManagedAgentRuntimeMaterializationInput<CustomConfig, RuntimePorts>) => {
      void input.identity;
      void input.config.model;
      // @ts-expect-error Runtime materializers receive the Config type owned by the codec.
      void input.config.provider;
      void input.ports.providerToken;
      // @ts-expect-error Namespace handles must not cross the runtime materializer boundary.
      void input.namespace;
      // @ts-expect-error Config revision belongs to provisioning, not the typed Config value.
      void input.config.revision;
      // @ts-expect-error Identity revision belongs to provisioning, not the runtime Identity.
      void input.identity.revision;
      return rawAgent;
    },
  },
  projection: { port: projectionPort },
});

void definition;

const contextDefinition = defineManagedAgentComposition({ ...definition, ...contextCapability });
const retrievalDefinition = defineManagedAgentComposition({
  ...definition,
  ...retrievalCapability,
});
const bothMemoryDefinition = defineManagedAgentComposition({
  ...contextDefinition,
  ...retrievalCapability,
});
void contextDefinition.contextMemoryManagement.resolve.inspect;
void retrievalDefinition.retrievalMemoryManagement.resolve.search;
void bothMemoryDefinition.contextMemoryManagement.resolve.apply;
void createContextMemoryManagementService(contextDefinition);
void createContextMemoryManagementService(bothMemoryDefinition);
// @ts-expect-error A known absent capability cannot create the Context management Service.
void createContextMemoryManagementService(definition);
// @ts-expect-error Retrieval installation does not install Context management.
void createContextMemoryManagementService(retrievalDefinition);
void createRetrievalMemoryManagementService(retrievalDefinition);
void createRetrievalMemoryManagementService(bothMemoryDefinition);
// @ts-expect-error A known absent capability cannot create Retrieval management.
void createRetrievalMemoryManagementService(definition);
// @ts-expect-error Context installation does not install Retrieval management.
void createRetrievalMemoryManagementService(contextDefinition);
// @ts-expect-error Absent capabilities must not appear on the Definition type.
void definition.contextMemoryManagement;
// @ts-expect-error Independent capabilities are not implicitly installed together.
void contextDefinition.retrievalMemoryManagement;
declare const memoryRequest: import('../../src/index.js').MemoryProvisioningRequest<
  NamespaceHandle,
  import('@print-an-agent/context-memory').ApplyMemoryInput
>;
const memoryInvocation = contextDefinition.contextMemoryManagement.resolve.apply(memoryRequest);
void memoryInvocation;
void contextDefinition.contextMemoryManagement.resolve.apply({
  ...memoryRequest,
  // @ts-expect-error apply cannot accept an inspect-only request.
  input: { memoryId: 'm' },
});

interface IncompatibleConfig {
  readonly provider: string;
}

// @ts-expect-error A materializer with a different Config contract cannot replace this one.
const incompatibleConfigMaterializer: (
  input: ManagedAgentRuntimeMaterializationInput<IncompatibleConfig, RuntimePorts>
) => ProductAgent = definition.runtime.materialize;
void incompatibleConfigMaterializer;

// @ts-expect-error A Port factory must accept the Config contract owned by this Definition.
const incompatibleConfigPortFactory: ManagedAgentRuntimePortFactory<
  IncompatibleConfig,
  NamespaceHandle,
  RuntimePorts
> = definition.runtime.createPorts;
void incompatibleConfigPortFactory;

declare const provisioningInput: ManagedAgentRuntimeProvisioningInput<
  CustomConfig,
  NamespaceHandle
>;
void definition.runtime.createPorts(provisioningInput);
// @ts-expect-error A namespace alone lacks the required authoritative provisioning context.
void definition.runtime.createPorts(provisioningInput.namespace);
// @ts-expect-error Callers cannot replace the authoritative Config snapshot in the input record.
provisioningInput.config = { value: { model: 'replacement' }, revision: 2 };
// @ts-expect-error Config snapshot revisions are readonly.
provisioningInput.config.revision = 2;

export type ConfigIsPreserved = Expect<
  Equal<ManagedAgentDefinitionConfig<typeof definition>, CustomConfig>
>;
export type RuntimePortsArePreserved = Expect<
  Equal<ManagedAgentDefinitionRuntimePorts<typeof definition>, RuntimePorts>
>;
export type RuntimeMaterializerConfigIsPreserved = Expect<
  Equal<Parameters<(typeof definition)['runtime']['materialize']>[0]['config'], CustomConfig>
>;
export type RuntimeProvisioningConfigIsPreserved = Expect<
  Equal<
    Parameters<(typeof definition)['runtime']['createPorts']>[0]['config'],
    ManagedAgentConfigSnapshot<CustomConfig>
  >
>;
export type RuntimeProvisioningIdentityIsPreserved = Expect<
  Equal<
    Parameters<(typeof definition)['runtime']['createPorts']>[0]['identity'],
    AgentIdentitySnapshot
  >
>;
export type RuntimeProvisioningNamespaceIsPreserved = Expect<
  Equal<
    Parameters<(typeof definition)['runtime']['createPorts']>[0]['namespace'],
    ManagedAgentNamespace<NamespaceHandle>
  >
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
export type CoreDefinitionHasNoNavigationCapability = Expect<
  Equal<'sessionNavigation' extends keyof typeof definition ? true : false, false>
>;

declare const widenedOptionalCapabilities: ManagedAgentCompositionCapabilitiesInput<NamespaceHandle>;
const definitionWithUncertainCapabilities = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  ...widenedOptionalCapabilities,
});
void definitionWithUncertainCapabilities;

export type OptionalManagementCapabilityIsNotClaimedAsInstalled = Expect<
  Equal<
    typeof definitionWithUncertainCapabilities extends SessionManagementCapability<
      NamespaceHandle,
      unknown
    >
      ? true
      : false,
    false
  >
>;
export type OptionalNavigationCapabilityIsNotClaimedAsInstalled = Expect<
  Equal<
    typeof definitionWithUncertainCapabilities extends SessionNavigationCapability<
      NamespaceHandle,
      unknown
    >
      ? true
      : false,
    false
  >
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

// @ts-expect-error Core Definitions do not silently gain standard Session navigation.
createSessionNavigationService(definition);

void management.inspect(managedAgentId);
void management.inspect(managedAgentId, { signal: new AbortController().signal });
// @ts-expect-error Management operation options are a closed public contract.
void management.inspect(managedAgentId, { signal: new AbortController().signal, retry: true });
const managedConfigCommit = management.updateConfig({
  agentId: managedAgentId,
  config: { model: 'test-model' },
  expectedRevision: 1,
});
void managedConfigCommit.then((result) => {
  const config: CustomConfig = result.authority.config.value;
  void config;
  // @ts-expect-error Mutation results separate committed authority from read snapshots.
  void result.config;
  if (result.projection.kind === 'failed') {
    const code: 'MANAGED_AGENT_PROJECTION_FAILED' = result.projection.failure.code;
    void code;
  }
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
export type SessionDefinitionHasNoNavigationCapability = Expect<
  Equal<'sessionNavigation' extends keyof typeof sessionDefinition ? true : false, false>
>;

const navigationDefinition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  sessionNavigation: {
    createPorts: (namespace) => {
      void namespace.handle.tenantId;
      return { navigationToken: 'navigation' as const };
    },
  },
});
void navigationDefinition;

type NavigationPorts = Readonly<{ navigationToken: 'navigation' }>;

export type NavigationCapabilityIsPreserved = Expect<
  Equal<
    typeof navigationDefinition extends SessionNavigationCapability<
      NamespaceHandle,
      NavigationPorts
    >
      ? true
      : false,
    true
  >
>;
export type NavigationDefinitionHasNoManagementCapability = Expect<
  Equal<'sessionManagement' extends keyof typeof navigationDefinition ? true : false, false>
>;
export type NavigationDefinitionPreservesRawAgent = Expect<
  Equal<MaterializedManagedAgent<typeof navigationDefinition>, ProductAgent>
>;

const asyncNavigationDefinition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  sessionNavigation: {
    createPorts: (): Promise<NavigationPorts> => Promise.resolve({ navigationToken: 'navigation' }),
  },
});
void asyncNavigationDefinition;

export type AsyncNavigationCapabilityAwaitsPorts = Expect<
  Equal<
    typeof asyncNavigationDefinition extends SessionNavigationCapability<
      NamespaceHandle,
      NavigationPorts
    >
      ? true
      : false,
    true
  >
>;

const bothCapabilitiesDefinition = defineManagedAgentComposition({
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
  sessionNavigation: {
    createPorts: () => ({ navigationToken: 'navigation' as const }),
  },
});
void bothCapabilitiesDefinition;

export type BothCapabilitiesPreserveManagement = Expect<
  Equal<
    typeof bothCapabilitiesDefinition extends SessionManagementCapability<
      NamespaceHandle,
      Readonly<{ sessionToken: 'session' }>
    >
      ? true
      : false,
    true
  >
>;
export type BothCapabilitiesPreserveNavigation = Expect<
  Equal<
    typeof bothCapabilitiesDefinition extends SessionNavigationCapability<
      NamespaceHandle,
      NavigationPorts
    >
      ? true
      : false,
    true
  >
>;
export type NavigationAliasPreservesCapability = Expect<
  Equal<
    typeof navigationDefinition extends SessionNavigationAgentCompositionDefinition<
      CustomConfig,
      NamespaceHandle,
      RuntimePorts,
      ProductAgent,
      NavigationPorts
    >
      ? true
      : false,
    true
  >
>;

function forwardManagementCapability<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionManagementPorts,
>(
  input: ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
    SessionManagementCapability<TNamespaceHandle, TSessionManagementPorts>
): SessionManagementCapability<
  TNamespaceHandle,
  TSessionManagementPorts
>['sessionManagement']['createPorts'] {
  const forwarded = defineManagedAgentComposition(input);
  return forwarded.sessionManagement.createPorts;
}
void forwardManagementCapability;

function forwardNavigationCapability<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionNavigationPorts,
>(
  input: ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
    SessionNavigationCapability<TNamespaceHandle, TSessionNavigationPorts>
): SessionNavigationCapability<
  TNamespaceHandle,
  TSessionNavigationPorts
>['sessionNavigation']['createPorts'] {
  const forwarded = defineManagedAgentComposition(input);
  return forwarded.sessionNavigation.createPorts;
}
void forwardNavigationCapability;

function forwardBothCapabilities<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionManagementPorts,
  TSessionNavigationPorts,
>(
  input: ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
    SessionManagementCapability<TNamespaceHandle, TSessionManagementPorts> &
    SessionNavigationCapability<TNamespaceHandle, TSessionNavigationPorts>
): Readonly<{
  management: SessionManagementCapability<
    TNamespaceHandle,
    TSessionManagementPorts
  >['sessionManagement']['createPorts'];
  navigation: SessionNavigationCapability<
    TNamespaceHandle,
    TSessionNavigationPorts
  >['sessionNavigation']['createPorts'];
}> {
  const forwarded = defineManagedAgentComposition(input);
  return {
    management: forwarded.sessionManagement.createPorts,
    navigation: forwarded.sessionNavigation.createPorts,
  };
}
void forwardBothCapabilities;

// @ts-expect-error Explicit undefined does not mean that the capability is absent.
defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  sessionNavigation: undefined,
});

defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  // @ts-expect-error Capabilities are a closed vocabulary, not arbitrary root plugins.
  unknownCapability: { createPorts: () => ({}) },
});

defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  // @ts-expect-error An installed capability must provide its complete wiring contract.
  sessionNavigation: {},
});

// @ts-expect-error A product-owned capability is not the standard Session management contract.
createSessionManagementService(sessionDefinition);

// @ts-expect-error Session management does not imply Session navigation.
createSessionNavigationService(sessionDefinition);

// @ts-expect-error Product-owned navigation ports are not the standard Session navigation contract.
createSessionNavigationService(navigationDefinition);

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
void sessionService.inspect(
  { agentId: managedAgentId, sessionId: managedSessionId },
  { signal: new AbortController().signal }
);

// @ts-expect-error Generic Session management accepts branded Agent IDs.
void sessionService.list({ agentId: 'managed-agent' });

// @ts-expect-error Generic Session management accepts branded Session IDs.
void sessionService.inspect({ agentId: managedAgentId, sessionId: 'managed-session' });

const sessionRuntime = createAgentRuntimeService(standardSessionDefinition).open(managedAgentId);
void sessionRuntime;
export type SessionCapabilityPreservesProductAgent = Expect<
  Equal<Awaited<typeof sessionRuntime>, ProductAgent>
>;

declare const sessionNavigationPorts: SessionNavigationPorts;
const standardNavigationDefinition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  sessionNavigation: {
    createPorts: (): SessionNavigationPorts => sessionNavigationPorts,
  },
});

const navigationService = createSessionNavigationService(standardNavigationDefinition);
void navigationService.inspect({ agentId: managedAgentId, sessionId: managedSessionId });

// @ts-expect-error Session navigation accepts branded Agent IDs.
void navigationService.inspect({ agentId: 'managed-agent', sessionId: managedSessionId });

// @ts-expect-error Session navigation accepts branded Session IDs.
void navigationService.inspect({ agentId: managedAgentId, sessionId: 'managed-session' });

// @ts-expect-error Session navigation does not imply Session management.
createSessionManagementService(standardNavigationDefinition);

const standardBothCapabilitiesDefinition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: (): RuntimePorts => ({ providerToken: 'provider' }),
    materialize: () => rawAgent,
  },
  sessionManagement: {
    createPorts: (): SessionManagementPorts => sessionManagementPorts,
  },
  sessionNavigation: {
    createPorts: (): SessionNavigationPorts => sessionNavigationPorts,
  },
});

createSessionManagementService(standardBothCapabilitiesDefinition);
createSessionNavigationService(standardBothCapabilitiesDefinition);

const asyncRuntimePortsDefinition = defineManagedAgentComposition({
  config: { codec },
  namespace: { port: namespacePort },
  authority: { createPorts: () => authorityPorts },
  runtime: {
    createPorts: ({ config }): Promise<RuntimePorts> =>
      Promise.resolve({ providerToken: config.value.model }),
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
export type AsyncRuntimeProvisioningConfigIsPreserved = Expect<
  Equal<
    Parameters<(typeof asyncRuntimePortsDefinition)['runtime']['createPorts']>[0]['config'],
    ManagedAgentConfigSnapshot<CustomConfig>
  >
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
