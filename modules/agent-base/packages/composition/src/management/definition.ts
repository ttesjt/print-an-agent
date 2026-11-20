import type { AgentConfigCodec } from '@print-an-agent/base-identity-config/config';
import type { ManagedAgentAuthorityPortFactory } from './contracts/authority.js';
import type { ManagedAgentNamespacePort } from './contracts/namespace.js';
import type { AgentConfigProjectionPort } from './contracts/projection.js';
import type {
  ManagedAgentRuntimeMaterializationInput,
  ManagedAgentRuntimeMaterializer,
  ManagedAgentRuntimePortFactory,
  RawManagedAgent,
} from './contracts/runtime.js';
import type {
  SessionManagementCapability,
  SessionManagementPortFactory,
} from './contracts/session-management.js';
import type {
  SessionNavigationCapability,
  SessionNavigationPortFactory,
} from './contracts/session-navigation.js';
import { ManagedAgentCompositionError } from './errors.js';
import type {
  ContextMemoryManagementCapability,
  RetrievalMemoryManagementCapability,
} from './contracts/memory.js';

interface ManagedAgentCompositionDefinitionInputShape<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
> {
  readonly config: Readonly<{
    codec: AgentConfigCodec<TConfig>;
  }>;
  readonly namespace: Readonly<{
    port: ManagedAgentNamespacePort<TNamespaceHandle>;
  }>;
  readonly authority: Readonly<{
    createPorts: ManagedAgentAuthorityPortFactory<TNamespaceHandle>;
  }>;
  readonly runtime: Readonly<{
    createPorts: ManagedAgentRuntimePortFactory<TConfig, TNamespaceHandle, TRuntimePorts>;
    materialize: (
      input: ManagedAgentRuntimeMaterializationInput<TConfig, TRuntimePorts>
    ) => TAgent | Promise<TAgent>;
  }>;
  readonly projection?: Readonly<{
    port: AgentConfigProjectionPort<TNamespaceHandle, TConfig>;
  }>;
}

type RawAgentConstraint<TAgent> = [RawManagedAgent<TAgent>] extends [never] ? never : unknown;

export type ManagedAgentCompositionDefinitionInput<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
> = ManagedAgentCompositionDefinitionInputShape<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  RawAgentConstraint<TAgent>;

export type SessionManagedAgentCompositionDefinitionInput<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionManagementPorts,
> = ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  SessionManagementCapability<TNamespaceHandle, TSessionManagementPorts>;

export type SessionNavigationAgentCompositionDefinitionInput<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionNavigationPorts,
> = ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  SessionNavigationCapability<TNamespaceHandle, TSessionNavigationPorts>;

export interface ManagedAgentCompositionDefinition<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
> {
  readonly config: Readonly<{
    codec: AgentConfigCodec<TConfig>;
  }>;
  readonly namespace: Readonly<{
    port: ManagedAgentNamespacePort<TNamespaceHandle>;
  }>;
  readonly authority: Readonly<{
    createPorts: ManagedAgentAuthorityPortFactory<TNamespaceHandle>;
  }>;
  readonly runtime: Readonly<{
    createPorts: ManagedAgentRuntimePortFactory<TConfig, TNamespaceHandle, TRuntimePorts>;
    materialize: ManagedAgentRuntimeMaterializer<TConfig, TRuntimePorts, TAgent>;
  }>;
  readonly projection?: Readonly<{
    port: AgentConfigProjectionPort<TNamespaceHandle, TConfig>;
  }>;
}

export type SessionManagedAgentCompositionDefinition<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionManagementPorts,
> = ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  SessionManagementCapability<TNamespaceHandle, TSessionManagementPorts>;

export type SessionNavigationAgentCompositionDefinition<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionNavigationPorts,
> = ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  SessionNavigationCapability<TNamespaceHandle, TSessionNavigationPorts>;

/** Closed capability input vocabulary; capability combinations are inferred rather than enumerated. */
export interface ManagedAgentCompositionCapabilitiesInput<TNamespaceHandle> {
  readonly contextMemoryManagement?: ContextMemoryManagementCapability<TNamespaceHandle>['contextMemoryManagement'];
  readonly retrievalMemoryManagement?: RetrievalMemoryManagementCapability<TNamespaceHandle>['retrievalMemoryManagement'];
  readonly sessionManagement?: Readonly<{
    createPorts: SessionManagementPortFactory<TNamespaceHandle, unknown>;
  }>;
  readonly sessionNavigation?: Readonly<{
    createPorts: SessionNavigationPortFactory<TNamespaceHandle, unknown>;
  }>;
}

type ManagedAgentCompositionCapabilityKey = keyof ManagedAgentCompositionCapabilitiesInput<unknown>;

/**
 * Preserve the caller's known capability fields without re-evaluating generic core constraints.
 * Required, optional, and absent fields therefore retain their exact presence semantics.
 */
type ManagedAgentCompositionCapabilitiesFromInput<TInput> = Readonly<
  Pick<TInput, Extract<keyof TInput, ManagedAgentCompositionCapabilityKey>>
>;

type RejectUnknownDefinitionFields<TAllowed, TInput> = Readonly<
  Record<Exclude<keyof TInput, keyof TAllowed>, never>
>;

export type ManagedAgentDefinitionConfig<TDefinition> =
  TDefinition extends Readonly<{
    config: Readonly<{ codec: Readonly<{ decode(value: unknown): infer TConfig }> }>;
  }>
    ? TConfig
    : never;

export type ManagedAgentDefinitionRuntimePorts<TDefinition> =
  TDefinition extends Readonly<{
    runtime: Readonly<{ createPorts: (...input: never[]) => infer TRuntimePorts }>;
  }>
    ? Awaited<TRuntimePorts>
    : never;

export type MaterializedManagedAgent<TDefinition> =
  TDefinition extends Readonly<{
    runtime: Readonly<{ materialize: (...input: never[]) => infer TResult }>;
  }>
    ? Awaited<TResult>
    : never;

type UnknownRecord = Readonly<Record<PropertyKey, unknown>>;

function invalid(fieldPath: string, expectation: string): never {
  throw new ManagedAgentCompositionError(
    fieldPath,
    `Managed Agent composition ${fieldPath} ${expectation}.`
  );
}

function requireClosedRecord(
  value: unknown,
  fieldPath: string,
  allowedKeys: readonly string[]
): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(fieldPath, 'must be a record');
  }
  const record = value as UnknownRecord;
  const keys = Reflect.ownKeys(record);
  for (const key of keys) {
    if (typeof key !== 'string') {
      return invalid(fieldPath, 'contains an unsupported symbol field');
    }
    if (!allowedKeys.includes(key)) {
      return invalid(`${fieldPath}.${key}`, 'is not supported');
    }
  }
  for (const key of allowedKeys) {
    if (!Object.hasOwn(record, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      return invalid(`${fieldPath}.${key}`, 'must be a data property');
    }
  }
  return record;
}

function requireDataProperty(record: UnknownRecord, key: string, fieldPath: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
    return invalid(fieldPath, 'is required and must be a data property');
  }
  return descriptor.value;
}

function findDataProperty(value: object, key: string): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      if (!Object.hasOwn(descriptor, 'value')) return undefined;
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function requireObject(value: unknown, fieldPath: string): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return invalid(fieldPath, 'must be an object');
  }
  return value;
}

function requireFunctionMember(value: object, memberName: string, fieldPath: string): void {
  if (typeof findDataProperty(value, memberName) !== 'function') {
    invalid(`${fieldPath}.${memberName}`, 'must be a function');
  }
}

function requireFunction(
  value: unknown,
  fieldPath: string
): asserts value is (...args: never[]) => unknown {
  if (typeof value !== 'function') invalid(fieldPath, 'must be a function');
}

function validateConfigCodec(value: unknown): void {
  const codec = requireObject(value, 'config.codec');
  const schemaVersion = findDataProperty(codec, 'schemaVersion');
  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) <= 0) {
    invalid('config.codec.schemaVersion', 'must be a positive safe integer');
  }
  requireFunctionMember(codec, 'decode', 'config.codec');
  requireFunctionMember(codec, 'encode', 'config.codec');
}

function validateNamespacePort(value: unknown): void {
  const port = requireObject(value, 'namespace.port');
  for (const method of ['stage', 'publish', 'abort', 'resolve', 'list']) {
    requireFunctionMember(port, method, 'namespace.port');
  }
}

function validateProjectionPort(value: unknown): void {
  const port = requireObject(value, 'projection.port');
  requireFunctionMember(port, 'publish', 'projection.port');
  requireFunctionMember(port, 'reconcile', 'projection.port');
}

export function defineManagedAgentComposition<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  const TInput extends object,
>(
  input: ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
    ManagedAgentCompositionCapabilitiesInput<TNamespaceHandle> &
    TInput &
    RejectUnknownDefinitionFields<
      ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
        ManagedAgentCompositionCapabilitiesInput<TNamespaceHandle>,
      TInput
    >
): ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  ManagedAgentCompositionCapabilitiesFromInput<TInput>;
export function defineManagedAgentComposition(input: unknown): unknown {
  const root = requireClosedRecord(input, 'definition', [
    'config',
    'namespace',
    'authority',
    'runtime',
    'projection',
    'sessionManagement',
    'sessionNavigation',
    'contextMemoryManagement',
    'retrievalMemoryManagement',
  ]);

  const config = requireClosedRecord(requireDataProperty(root, 'config', 'config'), 'config', [
    'codec',
  ]);
  const codec = requireDataProperty(config, 'codec', 'config.codec');
  validateConfigCodec(codec);

  const namespace = requireClosedRecord(
    requireDataProperty(root, 'namespace', 'namespace'),
    'namespace',
    ['port']
  );
  const namespacePort = requireDataProperty(namespace, 'port', 'namespace.port');
  validateNamespacePort(namespacePort);

  const authority = requireClosedRecord(
    requireDataProperty(root, 'authority', 'authority'),
    'authority',
    ['createPorts']
  );
  const createAuthorityPorts = requireDataProperty(
    authority,
    'createPorts',
    'authority.createPorts'
  );
  requireFunction(createAuthorityPorts, 'authority.createPorts');

  const runtime = requireClosedRecord(requireDataProperty(root, 'runtime', 'runtime'), 'runtime', [
    'createPorts',
    'materialize',
  ]);
  const createRuntimePorts = requireDataProperty(runtime, 'createPorts', 'runtime.createPorts');
  const materialize = requireDataProperty(runtime, 'materialize', 'runtime.materialize');
  requireFunction(createRuntimePorts, 'runtime.createPorts');
  requireFunction(materialize, 'runtime.materialize');

  const definition: Record<string, unknown> = {
    config: Object.freeze({ codec }),
    namespace: Object.freeze({ port: namespacePort }),
    authority: Object.freeze({ createPorts: createAuthorityPorts }),
    runtime: Object.freeze({ createPorts: createRuntimePorts, materialize }),
  };

  if (Object.hasOwn(root, 'projection')) {
    const projection = requireClosedRecord(
      requireDataProperty(root, 'projection', 'projection'),
      'projection',
      ['port']
    );
    const projectionPort = requireDataProperty(projection, 'port', 'projection.port');
    validateProjectionPort(projectionPort);
    definition.projection = Object.freeze({ port: projectionPort });
  }

  if (Object.hasOwn(root, 'sessionManagement')) {
    const sessionManagement = requireClosedRecord(
      requireDataProperty(root, 'sessionManagement', 'sessionManagement'),
      'sessionManagement',
      ['createPorts']
    );
    const createSessionManagementPorts = requireDataProperty(
      sessionManagement,
      'createPorts',
      'sessionManagement.createPorts'
    );
    requireFunction(createSessionManagementPorts, 'sessionManagement.createPorts');
    definition.sessionManagement = Object.freeze({
      createPorts: createSessionManagementPorts,
    });
  }

  if (Object.hasOwn(root, 'sessionNavigation')) {
    const sessionNavigation = requireClosedRecord(
      requireDataProperty(root, 'sessionNavigation', 'sessionNavigation'),
      'sessionNavigation',
      ['createPorts']
    );
    const createSessionNavigationPorts = requireDataProperty(
      sessionNavigation,
      'createPorts',
      'sessionNavigation.createPorts'
    );
    requireFunction(createSessionNavigationPorts, 'sessionNavigation.createPorts');
    definition.sessionNavigation = Object.freeze({
      createPorts: createSessionNavigationPorts,
    });
  }

  for (const [name, methods] of [
    [
      'contextMemoryManagement',
      ['inspect', 'getReceipt', 'replay', 'create', 'apply', 'configure', 'readContext'],
    ],
    [
      'retrievalMemoryManagement',
      [
        'inspect',
        'get',
        'getReceipt',
        'list',
        'replay',
        'create',
        'ingest',
        'update',
        'remove',
        'reindex',
        'search',
        'readContext',
      ],
    ],
  ] as const) {
    if (!Object.hasOwn(root, name)) continue;
    const capability = requireClosedRecord(requireDataProperty(root, name, name), name, [
      'resolve',
    ]);
    const resolve = requireClosedRecord(
      requireDataProperty(capability, 'resolve', `${name}.resolve`),
      `${name}.resolve`,
      methods
    );
    const factories: Record<string, unknown> = {};
    for (const method of methods) {
      const factory = requireDataProperty(resolve, method, `${name}.resolve.${method}`);
      requireFunction(factory, `${name}.resolve.${method}`);
      factories[method] = factory;
    }
    definition[name] = Object.freeze({ resolve: Object.freeze(factories) });
  }
  return Object.freeze(definition);
}
