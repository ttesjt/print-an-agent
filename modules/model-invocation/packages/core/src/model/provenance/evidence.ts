import type { ModelExecutionEvidence, ModelExecutionEvidenceValue } from './types.js';
import { MODEL_EXECUTION_PROVENANCE_LIMITS } from './limits.js';
import { invalid, requirePlainRecord, requireDataProperty } from './validation.js';

interface TraversalState {
  nodes: number;
  readonly ancestors: WeakSet<object>;
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

export function normalizeEvidence(value: unknown): ModelExecutionEvidence {
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
