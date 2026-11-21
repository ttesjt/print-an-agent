import { ModelInvocationError } from '../errors.js';
import { defineProviderModelReference } from '../provider/index.js';
import type {
  ModelExecutionProvenanceType,
  ProviderModelExecutionProvenance,
  EngineDefinedModelExecutionProvenance,
  ModelExecutionProvenance,
} from './types.js';
import { MODEL_EXECUTION_PROVENANCE_LIMITS } from './limits.js';
import { normalizeEvidence } from './evidence.js';
import { invalid, requirePlainRecord, assertExactKeys, requireDataProperty } from './validation.js';

const PROVENANCE_TYPE_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/i;

const PROVIDER_PROVENANCE_INPUT_KEYS = Object.freeze(['model', 'provider']);

const PROVIDER_PROVENANCE_KEYS = Object.freeze(['kind', ...PROVIDER_PROVENANCE_INPUT_KEYS]);

const ENGINE_DEFINED_PROVENANCE_INPUT_KEYS = Object.freeze(['evidence', 'type']);

const ENGINE_DEFINED_PROVENANCE_KEYS = Object.freeze(['evidence', 'kind', 'type']);

export function parseModelExecutionProvenanceType(value: unknown): ModelExecutionProvenanceType {
  if (
    typeof value !== 'string' ||
    value.length > MODEL_EXECUTION_PROVENANCE_LIMITS.maxTypeCharacters ||
    !PROVENANCE_TYPE_PATTERN.test(value)
  ) {
    throw invalid(
      `Model execution provenance type must contain 1-${MODEL_EXECUTION_PROVENANCE_LIMITS.maxTypeCharacters} letters, digits, dots, underscores, colons, slashes, or hyphens.`
    );
  }
  return value as ModelExecutionProvenanceType;
}

export function defineProviderModelExecutionProvenance(
  input: unknown
): ProviderModelExecutionProvenance {
  const record = requirePlainRecord(input, 'Provider model execution provenance');
  assertExactKeys(record, PROVIDER_PROVENANCE_INPUT_KEYS, 'Provider model execution provenance');
  try {
    const reference = defineProviderModelReference({
      provider: requireDataProperty(record, 'provider', 'Provider provenance provider'),
      model: requireDataProperty(record, 'model', 'Provider provenance model'),
    });
    return Object.freeze({
      kind: 'provider-model',
      provider: reference.provider,
      model: reference.model,
    });
  } catch (cause: unknown) {
    if (
      cause instanceof ModelInvocationError &&
      cause.code === 'MODEL_EXECUTION_PROVENANCE_INVALID'
    ) {
      throw cause;
    }
    throw invalid('Provider model execution provenance is invalid.', cause);
  }
}

export function defineEngineDefinedModelExecutionProvenance(
  input: unknown
): EngineDefinedModelExecutionProvenance {
  const record = requirePlainRecord(input, 'Engine-defined model execution provenance');
  assertExactKeys(
    record,
    ENGINE_DEFINED_PROVENANCE_INPUT_KEYS,
    'Engine-defined model execution provenance'
  );
  return Object.freeze({
    kind: 'engine-defined',
    type: parseModelExecutionProvenanceType(
      requireDataProperty(record, 'type', 'Engine-defined provenance type')
    ),
    evidence: normalizeEvidence(
      requireDataProperty(record, 'evidence', 'Engine-defined provenance evidence')
    ),
  });
}

export function defineModelExecutionProvenance(input: unknown): ModelExecutionProvenance {
  const record = requirePlainRecord(input, 'Model execution provenance');
  const kind = requireDataProperty(record, 'kind', 'Model execution provenance kind');
  if (kind === 'provider-model') {
    assertExactKeys(record, PROVIDER_PROVENANCE_KEYS, 'Provider model execution provenance');
    return defineProviderModelExecutionProvenance({
      provider: requireDataProperty(record, 'provider', 'Provider provenance provider'),
      model: requireDataProperty(record, 'model', 'Provider provenance model'),
    });
  }
  if (kind === 'engine-defined') {
    assertExactKeys(
      record,
      ENGINE_DEFINED_PROVENANCE_KEYS,
      'Engine-defined model execution provenance'
    );
    return defineEngineDefinedModelExecutionProvenance({
      type: requireDataProperty(record, 'type', 'Engine-defined provenance type'),
      evidence: requireDataProperty(record, 'evidence', 'Engine-defined provenance evidence'),
    });
  }
  throw invalid('Model execution provenance kind is unsupported.');
}
