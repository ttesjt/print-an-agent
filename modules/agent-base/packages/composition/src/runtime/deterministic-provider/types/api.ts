import type {
  AgentActorCatalogPort,
  AgentActorDefinitionInput,
  ResponsibilityCatalogPort,
  ResponsibilityDefinitionInput,
} from '@print-an-agent/agent-actor';
import type { ActorId } from '@print-an-agent/model-invocation-core';
import type { AgentAPI } from '../../agent-api.js';
import type { ComposeAgentOptions } from '../../standard-agent/index.js';
import type {
  DeterministicProviderInspection,
  DeterministicProviderRuntimeOptions,
} from './runtime.js';

export interface CreateDeterministicAgentAPIOptions extends Omit<
  ComposeAgentOptions,
  'actorCatalog' | 'responsibilityCatalog' | 'mainActorId' | 'requestWorkflow'
> {
  readonly provider: DeterministicProviderRuntimeOptions;
  readonly actorCatalog?: AgentActorCatalogPort;
  readonly responsibilityCatalog?: ResponsibilityCatalogPort;
  readonly mainActorId?: ActorId;
  readonly mainActor?: Omit<AgentActorDefinitionInput, 'id' | 'engineId'>;
  readonly responsibilities?: readonly ResponsibilityDefinitionInput[];
}

export interface DeterministicAgentAPI extends AgentAPI {
  inspectDeterministicProvider(): DeterministicProviderInspection;
}
