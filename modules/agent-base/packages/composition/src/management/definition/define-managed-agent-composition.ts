import type {
  ManagedAgentCompositionCapabilitiesInput,
  ManagedAgentCompositionDefinition,
  ManagedAgentCompositionDefinitionInput,
} from './types/definition.js';
import type {
  ManagedAgentCompositionCapabilitiesFromInput,
  RejectUnknownDefinitionFields,
} from './types/inference.js';
import { installDefinitionCapabilities } from './validate-definition.js';
import {
  requireClosedRecord,
  requireDataProperty,
  requireFunction,
  validateConfigCodec,
  validateNamespacePort,
  validateProjectionPort,
} from './validation.js';

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
  installDefinitionCapabilities(root, definition);
  return Object.freeze(definition);
}
