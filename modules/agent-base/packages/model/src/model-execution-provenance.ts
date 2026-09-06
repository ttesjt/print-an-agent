import { AgentModelError } from './errors.js';
import { defineProviderModelReference } from './provider-model-reference.js';
import type {
  EngineDefinedModelExecutionProvenance,
  ModelExecutionEvidence,
  ModelExecutionEvidenceValue,
  ModelExecutionProvenance,
  ModelExecutionProvenanceType,
  ProviderModelExecutionProvenance,
} from './types.js';

export const MODEL_EXECUTION_PROVENANCE_LIMITS = Object.freeze({
  maxTypeCharacters: 128,
  maxEvidenceDepth: 16,
  maxEvidenceNodes: 2_048,
  maxEvidenceKeyCharacters: 128,
  maxEvidenceStringCharacters: 32_768,
  maxEvidenceBytes: 65_536,
});

const PROVENANCE_TYPE_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/i;
const PROVIDER_PROVENANCE_INPUT_KEYS = Object.freeze(['model', 'provider']);
const PROVIDER_PROVENANCE_KEYS = Object.freeze(['kind', ...PROVIDER_PROVENANCE_INPUT_KEYS]);
const ENGINE_DEFINED_PROVENANCE_INPUT_KEYS = Object.freeze(['evidence', 'type']);
const ENGINE_DEFINED_PROVENANCE_KEYS = Object.freeze(['evidence', 'kind', 'type']);

interface TraversalState {
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function invalid(message: string, cause?: unknown): AgentModelError {
  return new AgentModelError(
    'MODEL_EXECUTION_PROVENANCE_INVALID',
    message,
    cause === undefined ? undefined : { cause }
  );
}

function requirePlainRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${label} must be a plain JSON object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid(`${label} must be a plain JSON object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid(`${label} cannot contain symbol properties.`);
  }
  return value as UnknownRecord;
}

function assertExactKeys(record: UnknownRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalid(`${label} has unsupported or missing fields.`);
  }
}

function requireDataProperty(record: UnknownRecord, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw invalid(`${label} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function countNode(depth: number, state: TraversalState): void {
  state.nodes += 1;
  if (state.nodes > MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceNodes) {
    throw invalid(
      `Model execution evidence cannot contain more than ${MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceNodes} values.`
    );
  }
  if (depth > MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceDepth) {
    throw invalid(
      `Model execution evidence cannot exceed ${MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceDepth} levels of nesting.`
    );
  }
}

function normalizeArray(
  value: readonly unknown[],
  depth: number,
  state: TraversalState
): readonly ModelExecutionEvidenceValue[] {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some(
      (key) =>
        typeof key !== 'string' ||
        (key !== 'length' &&
          (!/^\d+$/.test(key) || String(Number(key)) !== key || Number(key) >= value.length))
    )
  ) {
    throw invalid('Model execution evidence arrays cannot contain custom properties.');
  }
  const output: ModelExecutionEvidenceValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalid('Model execution evidence arrays must be dense data arrays.');
    }
    output.push(normalizeEvidenceValue(descriptor.value, depth + 1, state));
  }
  return Object.freeze(output);
}

function normalizeObject(
  value: object,
  depth: number,
  state: TraversalState
): Readonly<{ [key: string]: ModelExecutionEvidenceValue }> {
  const record = requirePlainRecord(value, 'Model execution evidence object');
  const output: { [key: string]: ModelExecutionEvidenceValue } = {};
  for (const key of Object.keys(record)) {
    if (
      key.length === 0 ||
      key.length > MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceKeyCharacters
    ) {
      throw invalid(
        `Model execution evidence keys must contain 1-${MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceKeyCharacters} characters.`
      );
    }
    Object.defineProperty(output, key, {
      value: normalizeEvidenceValue(
        requireDataProperty(record, key, 'Model execution evidence field'),
        depth + 1,
        state
      ),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (Reflect.ownKeys(record).length !== Object.keys(record).length) {
    throw invalid('Model execution evidence objects must contain only enumerable data fields.');
  }
  return Object.freeze(output);
}

function normalizeEvidenceValue(
  value: unknown,
  depth: number,
  state: TraversalState
): ModelExecutionEvidenceValue {
  countNode(depth, state);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceStringCharacters) {
      throw invalid(
        `Model execution evidence strings cannot exceed ${MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceStringCharacters} characters.`
      );
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalid('Model execution evidence numbers must be finite.');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw invalid('Model execution evidence contains a value that cannot be represented as JSON.');
  }
  if (state.ancestors.has(value)) {
    throw invalid('Model execution evidence cannot contain cyclic values.');
  }
  state.ancestors.add(value);
  try {
    return Array.isArray(value)
      ? normalizeArray(value, depth, state)
      : normalizeObject(value, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizeEvidence(value: unknown): ModelExecutionEvidence {
  const source = requirePlainRecord(value, 'Model execution evidence');
  const state: TraversalState = {
    nodes: 0,
    ancestors: new WeakSet(),
  };
  countNode(0, state);
  state.ancestors.add(source);
  let normalized: ModelExecutionEvidence;
  try {
    normalized = normalizeObject(source, 0, state);
  } finally {
    state.ancestors.delete(source);
  }
  const encoded = JSON.stringify(normalized);
  if (
    new TextEncoder().encode(encoded).byteLength >
    MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceBytes
  ) {
    throw invalid(
      `Model execution evidence cannot exceed ${MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceBytes} encoded bytes.`
    );
  }
  return normalized;
}

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
    if (cause instanceof AgentModelError && cause.code === 'MODEL_EXECUTION_PROVENANCE_INVALID') {
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
