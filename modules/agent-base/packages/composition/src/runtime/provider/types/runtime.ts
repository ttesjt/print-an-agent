import type {
  ProviderCredentialResolver,
  ProviderTransportLivenessPolicyInput,
  TextTokenInput,
  TokenCounter,
} from '@print-an-agent/model-invocation-core';
import type { ProviderConfigInput } from './configuration.js';

export interface ProviderRuntimeOptions {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly config: ProviderConfigInput;
  readonly credentialResolver?: ProviderCredentialResolver;
  readonly actorEngineId?: string;
  /** Optional provider transport liveness; omission adds no Agent Base transport deadline. */
  readonly transportLivenessPolicy?: ProviderTransportLivenessPolicyInput;
}
