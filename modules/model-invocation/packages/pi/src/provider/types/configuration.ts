import type {
  ProviderModelReferenceInput,
  ProviderModelReference,
} from '@print-an-agent/model-invocation-core';

export interface PiBuiltinProviderConfigInput {
  readonly kind: 'builtin';
  readonly reference: ProviderModelReferenceInput;
}

export interface PiOpenAICompatibleProviderCompatibility {
  /** Whether the endpoint accepts OpenAI's developer message role for instructions. */
  readonly supportsDeveloperRole: boolean;
}

export interface PiOpenAICompatibleProviderConfigInput {
  readonly kind: 'openai-compatible';
  readonly reference: ProviderModelReferenceInput;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Declares endpoint capability; it does not request reasoning generation. */
  readonly supportsReasoning: boolean;
  readonly compatibility: PiOpenAICompatibleProviderCompatibility;
}

export type PiProviderConfigInput =
  | PiBuiltinProviderConfigInput
  | PiOpenAICompatibleProviderConfigInput;

export interface DefinedPiBuiltinProviderConfig extends Omit<
  PiBuiltinProviderConfigInput,
  'reference'
> {
  readonly reference: ProviderModelReference;
}
export interface DefinedPiOpenAICompatibleProviderConfig extends Omit<
  PiOpenAICompatibleProviderConfigInput,
  'reference'
> {
  readonly reference: ProviderModelReference & { readonly baseUrl: string };
}
export type DefinedPiProviderConfig =
  | DefinedPiBuiltinProviderConfig
  | DefinedPiOpenAICompatibleProviderConfig;
