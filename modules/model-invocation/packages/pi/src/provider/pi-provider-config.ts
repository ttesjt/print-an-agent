import {
  ModelInvocationError,
  defineProviderModelReference,
} from '@ta-agent/model-invocation-core';
import type { PiOpenAICompatibleProviderCompatibility } from './types.js';

const BUILTIN_PROVIDER_CONFIG_KEYS = Object.freeze(['kind', 'reference']);
const OPENAI_COMPATIBLE_PROVIDER_CONFIG_KEYS = Object.freeze([
  'kind',
  'reference',
  'contextWindowTokens',
  'maxOutputTokens',
  'supportsReasoning',
  'compatibility',
]);
const OPENAI_COMPATIBILITY_KEYS = Object.freeze(['supportsDeveloperRole']);

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
  /** Declares endpoint capability; it does not request reasoning generation. */
  readonly supportsReasoning: boolean;
  readonly compatibility: PiOpenAICompatibleProviderCompatibility;
}

export type DefinedPiProviderConfig =
  | DefinedPiBuiltinProviderConfig
  | DefinedPiOpenAICompatibleProviderConfig;

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new ModelInvocationError(
      'MODEL_REFERENCE_INVALID',
      `${label} contains unsupported field "${unexpected}".`
    );
  }
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ModelInvocationError(
      'MODEL_REFERENCE_INVALID',
      `${label} must be a positive safe integer.`
    );
  }
  return value as number;
}

function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ModelInvocationError('MODEL_REFERENCE_INVALID', `${label} must be a boolean.`);
  }
  return value;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defineBuiltinProviderConfig(input: UnknownRecord): DefinedPiBuiltinProviderConfig {
  const reference = defineProviderModelReference(input.reference);
  if (reference.credentialRef === undefined) {
    throw new ModelInvocationError(
      'MODEL_REFERENCE_INVALID',
      'Builtin provider configuration requires a credential reference.'
    );
  }
  return Object.freeze({ kind: 'builtin', reference });
}

function defineOpenAICompatibleProviderConfig(
  input: UnknownRecord
): DefinedPiOpenAICompatibleProviderConfig {
  const reference = defineProviderModelReference(input.reference);
  if (reference.baseUrl === undefined) {
    throw new ModelInvocationError(
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
  const supportsReasoning = parseBoolean(
    input.supportsReasoning,
    'OpenAI-compatible supportsReasoning'
  );
  if (!isUnknownRecord(input.compatibility)) {
    throw new ModelInvocationError(
      'MODEL_REFERENCE_INVALID',
      'OpenAI-compatible compatibility must be an object.'
    );
  }
  assertExactKeys(
    input.compatibility,
    OPENAI_COMPATIBILITY_KEYS,
    'OpenAI-compatible compatibility'
  );
  const compatibility = Object.freeze({
    supportsDeveloperRole: parseBoolean(
      input.compatibility.supportsDeveloperRole,
      'OpenAI-compatible compatibility.supportsDeveloperRole'
    ),
  });
  if (maxOutputTokens > contextWindowTokens) {
    throw new ModelInvocationError(
      'MODEL_REFERENCE_INVALID',
      'OpenAI-compatible maxOutputTokens cannot exceed contextWindowTokens.'
    );
  }
  return Object.freeze({
    kind: 'openai-compatible',
    reference: Object.freeze({ ...reference, baseUrl: reference.baseUrl }),
    contextWindowTokens,
    maxOutputTokens,
    supportsReasoning,
    compatibility,
  });
}

export function definePiProviderConfig(input: unknown): DefinedPiProviderConfig {
  if (!isUnknownRecord(input)) {
    throw new ModelInvocationError(
      'MODEL_REFERENCE_INVALID',
      'Provider configuration must be an object.'
    );
  }
  if (input.kind === 'builtin') {
    assertExactKeys(input, BUILTIN_PROVIDER_CONFIG_KEYS, 'Builtin provider configuration');
    return defineBuiltinProviderConfig(input);
  }
  if (input.kind === 'openai-compatible') {
    assertExactKeys(
      input,
      OPENAI_COMPATIBLE_PROVIDER_CONFIG_KEYS,
      'OpenAI-compatible provider configuration'
    );
    return defineOpenAICompatibleProviderConfig(input);
  }
  throw new ModelInvocationError(
    'MODEL_REFERENCE_INVALID',
    'Provider configuration kind is invalid.'
  );
}
