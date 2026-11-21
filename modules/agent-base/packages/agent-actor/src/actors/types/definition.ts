import type {
  ActorDefinition as ModelActorDefinition,
  ActorDefinitionInput as ModelActorDefinitionInput,
  ResolvedActor as ResolvedModelActor,
} from '@print-an-agent/model-invocation-core';
import type { ToolName } from '@print-an-agent/base-tool';

export interface AgentActorDefinitionInput extends ModelActorDefinitionInput {
  readonly allowedTools?: readonly string[];
}
export interface AgentActorDefinition extends ModelActorDefinition {
  readonly allowedTools: readonly ToolName[];
}
export interface ResolvedAgentActor extends ResolvedModelActor {
  readonly catalogRevision: number;
  readonly allowedTools: readonly ToolName[];
}
