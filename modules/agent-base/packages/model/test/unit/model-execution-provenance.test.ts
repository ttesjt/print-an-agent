import { describe, expect, it } from 'vitest';
import {
  AgentModelError,
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  defineModelExecutionProvenance,
  defineProviderModelExecutionProvenance,
  MODEL_EXECUTION_PROVENANCE_LIMITS,
} from '../../src/index.js';

const usage = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  totalTokens: 10,
};

function expectModelError(action: () => unknown, code: AgentModelError['code']): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toEqual(expect.objectContaining<Partial<AgentModelError>>({ code }));
}

function engineProvenance(evidence: unknown) {
  return defineEngineDefinedModelExecutionProvenance({
    type: 'example.runtime-target/v1',
    evidence,
  });
}

describe('Model execution provenance', () => {
  it('defines a closed provider/model variant from ordinary provider identity', () => {
    const provenance = defineProviderModelExecutionProvenance({
      provider: 'local-openai',
      model: 'org/model-v2',
    });

    expect(provenance).toEqual({
      kind: 'provider-model',
      provider: 'local-openai',
      model: 'org/model-v2',
    });
    expect(Object.isFrozen(provenance)).toBe(true);
    expectModelError(
      () =>
        defineModelExecutionProvenance({
          ...provenance,
          credentialRef: 'must-not-cross-the-boundary',
        }),
      'MODEL_EXECUTION_PROVENANCE_INVALID'
    );
  });

  it('clones and deeply freezes bounded engine-defined JSON evidence', () => {
    const source = {
      artifact: { id: 'artifact-1', revision: 3 },
      route: ['local', { runtime: 'embedded' }],
      ready: true,
      nullable: null,
      negativeZero: -0,
    };
    const provenance = engineProvenance(source);
    source.artifact.id = 'mutated-after-definition';

    expect(provenance).toEqual({
      kind: 'engine-defined',
      type: 'example.runtime-target/v1',
      evidence: {
        artifact: { id: 'artifact-1', revision: 3 },
        route: ['local', { runtime: 'embedded' }],
        ready: true,
        nullable: null,
        negativeZero: 0,
      },
    });
    expect(Object.isFrozen(provenance)).toBe(true);
    expect(Object.isFrozen(provenance.evidence)).toBe(true);
    expect(Object.isFrozen(provenance.evidence.artifact)).toBe(true);
    expect(Object.isFrozen(provenance.evidence.route)).toBe(true);
  });

  it.each([
    ['undefined', { value: undefined }],
    ['function', { value: () => undefined }],
    ['symbol', { value: Symbol('not-json') }],
    ['non-finite number', { value: Number.NaN }],
    ['class instance', { value: new Date(0) }],
    ['sparse array', { value: new Array(2) }],
  ])('rejects %s evidence values', (_label, evidence) => {
    expectModelError(() => engineProvenance(evidence), 'MODEL_EXECUTION_PROVENANCE_INVALID');
  });

  it('rejects accessors, symbols, cycles, and non-object evidence roots', () => {
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 'hidden-work' });
    const withSymbol = { value: 'visible' };
    Object.defineProperty(withSymbol, Symbol('hidden'), { enumerable: true, value: 'private' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const evidence of [accessor, withSymbol, cyclic, ['not-an-object-root']]) {
      expectModelError(() => engineProvenance(evidence), 'MODEL_EXECUTION_PROVENANCE_INVALID');
    }
  });

  it('enforces type, depth, node, key, string, and encoded-byte bounds', () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let index = 0; index <= MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceDepth; index += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }

    const excessiveNodes = Array.from(
      { length: MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceNodes },
      () => 0
    );
    const excessiveBytes = {
      first: 'a'.repeat(MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceStringCharacters),
      second: 'b'.repeat(MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceStringCharacters),
      third: 'c'.repeat(MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceStringCharacters),
    };

    for (const evidence of [
      deeplyNested,
      { values: excessiveNodes },
      { ['x'.repeat(MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceKeyCharacters + 1)]: true },
      { value: 'x'.repeat(MODEL_EXECUTION_PROVENANCE_LIMITS.maxEvidenceStringCharacters + 1) },
      excessiveBytes,
    ]) {
      expectModelError(() => engineProvenance(evidence), 'MODEL_EXECUTION_PROVENANCE_INVALID');
    }

    for (const type of ['', 'contains space', 'x'.repeat(129)]) {
      expectModelError(
        () => defineEngineDefinedModelExecutionProvenance({ type, evidence: {} }),
        'MODEL_EXECUTION_PROVENANCE_INVALID'
      );
    }
  });

  it('normalizes the complete assistant-message boundary and rejects the old shape', () => {
    const provenance = engineProvenance({ target: 'immutable-output' });
    const message = defineAssistantModelMessage({
      role: 'assistant',
      text: 'completed',
      provenance,
      stopReason: 'stop',
      usage,
      timestamp: 5,
    });

    expect(message.provenance).toEqual(provenance);
    expect(Object.isFrozen(message)).toBe(true);
    expect(Object.isFrozen(message.usage)).toBe(true);
    expectModelError(
      () =>
        defineAssistantModelMessage({
          role: 'assistant',
          text: 'legacy',
          provider: 'provider',
          model: 'model',
          stopReason: 'stop',
          usage,
          timestamp: 5,
        }),
      'MODEL_MESSAGE_INVALID'
    );
  });
});
