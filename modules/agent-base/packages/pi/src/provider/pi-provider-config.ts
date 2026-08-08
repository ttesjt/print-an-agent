import { AgentModelError, defineProviderModelReference } from '@ta-agent/base-model';
import type {
  PiBuiltinProviderConfigInput,
  PiOpenAICompatibleProviderConfigInput,
  PiProviderConfigInput,
} from './types.js';

const BUILTIN_PROVIDER_CONFIG_KEYS = Object.freeze(['kind', 'reference']);
const OPENAI_COMPATIBLE_PROVIDER_CONFIG_KEYS = Object.freeze([
  'kind',
  'reference',
  'contextWindowTokens',
  'maxOutputTokens',
]);

export interface DefinedPiBuiltinProviderConfig {
  readonly kind: 'builtin';
  readonly reference: ReturnType<typeof defineProviderModelReference>;
}

export interface DefinedPiOpenAICompatibleProviderConfig {
  readonly kind: 'openai-compatible';
  readonly reference: ReturnType<typeof defineProviderModelReference> & {
    readonly baseUrl: string;
  };
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

export type DefinedPiProviderConfig =
  | DefinedPiBuiltinProviderConfig
  | DefinedPiOpenAICompatibleProviderConfig;

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      `${label} contains unsupported field "${unexpected}".`
    );
  }
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      `${label} must be a positive safe integer.`
    );
  }
  return value as number;
}

function defineBuiltinProviderConfig(
  input: PiBuiltinProviderConfigInput
): DefinedPiBuiltinProviderConfig {
  const reference = defineProviderModelReference(input.reference);
  if (reference.credentialRef === undefined) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      'Pi builtin provider configuration requires a credential reference.'
    );
  }
  return Object.freeze({ kind: 'builtin', reference });
}

function defineOpenAICompatibleProviderConfig(
  input: PiOpenAICompatibleProviderConfigInput
): DefinedPiOpenAICompatibleProviderConfig {
  const reference = defineProviderModelReference(input.reference);
  if (reference.baseUrl === undefined) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      'OpenAI-compatible provider configuration requires a base URL.'
    );
  }
  const contextWindowTokens = parsePositiveInteger(
    input.contextWindowTokens,
    'OpenAI-compatible contextWindowTokens'
  );
  const maxOutputTokens = parsePositiveInteger(
    input.maxOutputTokens,
    'OpenAI-compatible maxOutputTokens'
  );
  if (maxOutputTokens > contextWindowTokens) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      'OpenAI-compatible maxOutputTokens cannot exceed contextWindowTokens.'
    );
  }
  return Object.freeze({
    kind: 'openai-compatible',
    reference: Object.freeze({ ...reference, baseUrl: reference.baseUrl }),
    contextWindowTokens,
    maxOutputTokens,
  });
}

export function definePiProviderConfig(input: PiProviderConfigInput): DefinedPiProviderConfig {
  if (typeof input !== 'object' || input === null) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      'Pi provider configuration must be an object.'
    );
  }
  if (input.kind === 'builtin') {
    assertExactKeys(input, BUILTIN_PROVIDER_CONFIG_KEYS, 'Pi builtin provider configuration');
    return defineBuiltinProviderConfig(input);
  }
  if (input.kind === 'openai-compatible') {
    assertExactKeys(
      input,
      OPENAI_COMPATIBLE_PROVIDER_CONFIG_KEYS,
      'Pi OpenAI-compatible provider configuration'
    );
    return defineOpenAICompatibleProviderConfig(input);
  }
  throw new AgentModelError(
    'MODEL_REFERENCE_INVALID',
    'Pi provider configuration kind is invalid.'
  );
}
