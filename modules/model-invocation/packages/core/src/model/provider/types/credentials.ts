import type { ProviderId, ProviderCredentialReference } from './reference.js';

export interface ProviderApiKeyCredential {
  readonly type: 'api-key';
  readonly apiKey: string;
}

export interface ProviderCredentialResolutionRequest {
  readonly reference: ProviderCredentialReference;
  readonly provider: ProviderId;
  readonly signal: AbortSignal;
}

export interface ProviderCredentialResolver {
  resolve(
    request: ProviderCredentialResolutionRequest
  ): Promise<ProviderApiKeyCredential | undefined>;
}
