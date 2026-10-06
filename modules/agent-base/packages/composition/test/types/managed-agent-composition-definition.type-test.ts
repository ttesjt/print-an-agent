import type { AgentConfigCodec } from '@ta-agent/base-config';
import {
  parseAgentId,
  type AgentIdentityCatalogPort,
  type AgentIdentitySnapshot,
} from '@ta-agent/base-identity';
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
