import type {
  ActorDefinitionInput,
  ResponsibilityDefinitionInput,
} from '@print-an-agent/base-actor';
import type { AgentAPI } from '../../agent-api.js';
import type { ComposeAgentOptions } from '../../standard-agent/index.js';
import type { ProviderReadiness, ProviderRuntimeInspection } from './inspection.js';
import type { ProviderRuntimeOptions } from './runtime.js';

export interface CreateProviderAgentAPIOptions extends Omit<
  ComposeAgentOptions,
  'actorCatalog' | 'responsibilityCatalog' | 'mainActorId'
> {
  readonly provider: ProviderRuntimeOptions;
  readonly mainActor?: Omit<ActorDefinitionInput, 'id' | 'engineId'>;
  readonly responsibilities?: readonly ResponsibilityDefinitionInput[];
}

export interface ProviderAgentAPI extends AgentAPI {
  inspectProvider(): ProviderRuntimeInspection;
  checkProviderReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<ProviderReadiness>;
}
