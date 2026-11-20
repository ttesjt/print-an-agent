import type {
  ProviderModelReference,
  ProviderModelReferenceInput,
} from '@print-an-agent/model-invocation-core';

export interface BuiltinProviderConfigInput {
  readonly kind: 'builtin';
  readonly reference: ProviderModelReferenceInput;
}

export interface OpenAICompatibleProviderCompatibility {
  /** Whether the endpoint accepts OpenAI's developer message role for instructions. */
  readonly supportsDeveloperRole: boolean;
}

export interface OpenAICompatibleProviderConfigInput {
  readonly kind: 'openai-compatible';
  readonly reference: ProviderModelReferenceInput;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Declares endpoint capability; it does not request reasoning generation. */
  readonly supportsReasoning: boolean;
  readonly compatibility: OpenAICompatibleProviderCompatibility;
}

export type ProviderConfigInput = BuiltinProviderConfigInput | OpenAICompatibleProviderConfigInput;

export interface DefinedBuiltinProviderConfig {
  readonly kind: 'builtin';
  readonly reference: ProviderModelReference;
}

export interface DefinedOpenAICompatibleProviderConfig {
  readonly kind: 'openai-compatible';
  readonly reference: ProviderModelReference & Readonly<{ baseUrl: string }>;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Declares endpoint capability; it does not request reasoning generation. */
  readonly supportsReasoning: boolean;
  readonly compatibility: OpenAICompatibleProviderCompatibility;
}

export type DefinedProviderConfig =
  | DefinedBuiltinProviderConfig
  | DefinedOpenAICompatibleProviderConfig;
