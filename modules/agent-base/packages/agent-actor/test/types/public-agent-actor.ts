import {
  createAgentActorCatalog,
  defineAgentActor,
  type AgentActorCatalogPort,
  type AgentActorDefinition,
  type AgentActorDefinitionInput,
  type CreateAgentActorCatalogOptions,
  type ResolvedAgentActor,
} from '@print-an-agent/agent-actor';
import {
  createActorCatalog,
  defineActor,
  type ActorDefinition,
  type ActorDefinitionInput,
  type ActorCatalogPort,
  type CreateActorCatalogOptions,
  type ResolvedActor,
} from '@print-an-agent/model-invocation-core';

export function checkAgentActorPublicTypes(
  input: AgentActorDefinitionInput,
  options: CreateAgentActorCatalogOptions
): void {
  const definition: AgentActorDefinition = defineAgentActor(input);
  const coreDefinition: ActorDefinition = definition;
  const coreInput: ActorDefinitionInput = input;
  const coreOptions: CreateActorCatalogOptions = options;
  const catalog: AgentActorCatalogPort = createAgentActorCatalog(options);
  const coreCatalog: ActorCatalogPort = createActorCatalog(coreOptions);
  const resolved: Promise<ResolvedAgentActor> = catalog.resolve(definition.id);
  const coreResolved: Promise<ResolvedActor> = resolved;
  void coreDefinition;
  void coreCatalog;
  void coreResolved;
  void defineActor(coreInput);
}
