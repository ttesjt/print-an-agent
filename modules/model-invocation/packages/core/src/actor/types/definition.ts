import type { ModelInteractionResult } from '../../model/index.js';
import type { TokenCounter, TextTokenInput } from '../../token-measurement/index.js';
import type { ActorEngineCapabilities, ActorCapabilityLimits } from '../capabilities/index.js';
import type { ActorId, ActorEngineId } from '../identifiers.js';
import type { ActorInvocationPolicyInput } from '../invocation-policy.js';
import type {
  ActorInvocationBinding,
  ActorInvocationConfig,
  ActorInteractionRequest,
  ActorDirectRequest,
  ActorDirectResult,
  ActorStreamingRequest,
} from './invocation.js';
import type { ActorEngineInput } from './engine.js';

export interface ActorDefinitionInput {
  /** Optional borrowed override; absence inherits the Engine's text measurement capability. */
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: string;
  readonly engineId: string;
  readonly instructions?: string;
  readonly invocationConfig?: ActorInvocationConfig;
  readonly invocationPolicy?: ActorInvocationPolicyInput;
  readonly capabilityLimits?: ActorCapabilityLimits;
}

export interface ActorDefinition extends ActorInvocationBinding {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly engineId: ActorEngineId;
  readonly capabilityLimits?: ActorCapabilityLimits;
}

export interface ResolvedActor {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: ActorId;
  readonly engineId: ActorEngineId;
  readonly catalogRevision?: number;
  readonly capabilities: ActorEngineCapabilities;
  interact?(request: ActorInteractionRequest): Promise<ModelInteractionResult>;
  complete?(request: ActorDirectRequest): Promise<ActorDirectResult>;
  stream?(request: ActorStreamingRequest): Promise<ActorDirectResult>;
}

export interface CreateActorOptions extends Omit<ActorDefinitionInput, 'engineId'> {
  readonly engine: ActorEngineInput;
}
