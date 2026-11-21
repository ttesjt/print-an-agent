declare const providerIdBrand: unique symbol;

declare const providerModelIdBrand: unique symbol;

declare const providerCredentialReferenceBrand: unique symbol;

export type ProviderId = string & { readonly [providerIdBrand]: 'ProviderId' };

export type ProviderModelId = string & { readonly [providerModelIdBrand]: 'ProviderModelId' };

export type ProviderCredentialReference = string & {
  readonly [providerCredentialReferenceBrand]: 'ProviderCredentialReference';
};

export interface ProviderModelReferenceInput {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly credentialRef?: string;
}

export interface ProviderModelReference {
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
  readonly baseUrl?: string;
  readonly credentialRef?: ProviderCredentialReference;
}

export interface ExecutionTargetCapabilities {
  readonly streaming: true;
  readonly tools: boolean;
}

export interface ResolvedExecutionTarget {
  readonly reference: ProviderModelReference;
  readonly capabilities: ExecutionTargetCapabilities;
}
