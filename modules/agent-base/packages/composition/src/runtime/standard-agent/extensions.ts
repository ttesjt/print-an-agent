import { createAgent, type AgentOperationDefinitionMap } from '@print-an-agent/base-runtime';
import {
  createStandardAgentDefinition,
  type StandardAgentDefinition,
  type StandardAgentOperations,
  type StandardAgentResources,
} from './create-definition.js';
import { AgentCompositionError } from './errors.js';
import type { ComposeAgentOptions } from './types/options.js';

type WithoutStandardKeys<TCandidate, TStandard> = TCandidate &
  Readonly<Record<Extract<keyof TCandidate, keyof TStandard>, never>>;

export type AgentCompositionExtension<
  TResources extends object,
  TOperations extends AgentOperationDefinitionMap,
> = Readonly<{
  resources: WithoutStandardKeys<TResources, StandardAgentResources>;
  operations: WithoutStandardKeys<TOperations, StandardAgentOperations>;
}>;

export type AgentCompositionExtensionFactory<
  TResources extends object,
  TOperations extends AgentOperationDefinitionMap,
> = (standard: StandardAgentDefinition) => AgentCompositionExtension<TResources, TOperations>;

function assertExtensionRecord(value: unknown, subjectName: string): asserts value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentCompositionError(
      'AGENT_COMPOSITION_EXTENSION_INVALID',
      `Agent composition extension ${subjectName} must be a record.`,
      subjectName
    );
  }
}

function mergeDistinctRecords<TStandard extends object, TExtension extends object>(
  subjectName: 'operations' | 'resources',
  standard: TStandard,
  extension: TExtension
) {
  for (const name of Object.keys(extension)) {
    if (Object.hasOwn(standard, name)) {
      const code =
        subjectName === 'operations'
          ? 'AGENT_COMPOSITION_OPERATION_NAME_CONFLICT'
          : 'AGENT_COMPOSITION_RESOURCE_NAME_CONFLICT';
      throw new AgentCompositionError(
        code,
        `Agent composition extension cannot replace standard ${subjectName.slice(0, -1)} "${name}".`,
        name
      );
    }
  }
  return Object.freeze({ ...standard, ...extension });
}

export function composeAgentWithExtensions<
  const TResources extends object,
  const TOperations extends AgentOperationDefinitionMap,
>(
  options: ComposeAgentOptions,
  createExtension: AgentCompositionExtensionFactory<TResources, TOperations>
) {
  const standard = createStandardAgentDefinition(options);
  const extension = createExtension(standard);
  assertExtensionRecord(extension, 'definition');
  assertExtensionRecord(extension.resources, 'resources');
  assertExtensionRecord(extension.operations, 'operations');
  const extensionResources: TResources = extension.resources;
  const extensionOperations: TOperations = extension.operations;

  return createAgent({
    identity: standard.identity,
    resources: mergeDistinctRecords('resources', standard.resources, extensionResources),
    operations: mergeDistinctRecords('operations', standard.operations, extensionOperations),
    observability: standard.observability,
  });
}
