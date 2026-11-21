import type {
  ActorInvocationConfig,
  ActorInvocationPolicy,
  ActorInvocationPolicyInput,
} from '@print-an-agent/model-invocation-core';

export interface StandaloneMainActorConfigInput {
  readonly instructions?: string;
  readonly invocationConfig?: ActorInvocationConfig;
  readonly invocationPolicy?: ActorInvocationPolicyInput;
}

export interface StandaloneMainActorConfig {
  readonly instructions?: string;
  readonly invocationConfig: ActorInvocationConfig;
  readonly invocationPolicy: ActorInvocationPolicy;
}
