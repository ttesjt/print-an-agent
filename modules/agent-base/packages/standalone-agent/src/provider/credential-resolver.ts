import type {
  ProviderCredentialResolutionRequest,
  ProviderCredentialResolver,
} from '@print-an-agent/model-invocation-core';
import type { StandaloneCredentialBindingInput } from '../configuration/index.js';
import type { StandaloneCredentialRuntimeOptions } from './types.js';

export function createStandaloneCredentialResolver(
  binding: Readonly<StandaloneCredentialBindingInput>,
  options: StandaloneCredentialRuntimeOptions
): ProviderCredentialResolver {
  return Object.freeze({
    resolve: (request: ProviderCredentialResolutionRequest) => {
      if (request.reference !== binding.reference) return Promise.resolve(undefined);
      const apiKey = options.readEnvironmentVariable(binding.environmentVariable);
      if (apiKey === undefined || apiKey.length === 0) return Promise.resolve(undefined);
      return Promise.resolve(Object.freeze({ type: 'api-key', apiKey }));
    },
  });
}
