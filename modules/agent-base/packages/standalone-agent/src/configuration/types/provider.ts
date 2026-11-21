import type { DefinedProviderConfig, ProviderConfigInput } from '@print-an-agent/base-composition';
import type {
  ProviderTransportLivenessPolicy,
  ProviderTransportLivenessPolicyInput,
} from '@print-an-agent/model-invocation-core';
import type {
  TextTokenCounterConfig,
  TextTokenCounterConfigInput,
} from '@print-an-agent/model-invocation-token-counters';

export interface StandaloneProviderConfigInput {
  readonly textTokenCounter?: TextTokenCounterConfigInput;
  readonly config: ProviderConfigInput;
  readonly transportLivenessPolicy?: ProviderTransportLivenessPolicyInput;
}

export interface StandaloneProviderConfig {
  readonly textTokenCounter?: TextTokenCounterConfig;
  readonly config: DefinedProviderConfig;
  readonly transportLivenessPolicy: ProviderTransportLivenessPolicy;
}
