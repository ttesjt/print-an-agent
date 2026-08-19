import { describe, expect, it } from 'vitest';

import {
  InvalidWorkbenchValueError,
  ModelStateKind,
  defineModelState,
  modelStatesEqual,
} from '../../src/index.js';

describe('Model State', () => {
  it('represents one Base plus an ordered Modification stack', () => {
    const state = defineModelState({
      baseId: 'base:foundation',
      modificationIds: ['modification:domain', 'modification:task'],
    });
    const same = defineModelState({
      baseId: 'base:foundation',
      modificationIds: ['modification:domain', 'modification:task'],
    });
    const reordered = defineModelState({
      baseId: 'base:foundation',
      modificationIds: ['modification:task', 'modification:domain'],
    });

    expect(state).toMatchObject({
      kind: ModelStateKind.State,
      baseId: 'base:foundation',
      modificationIds: ['modification:domain', 'modification:task'],
    });
    expect(state.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(modelStatesEqual(state, same)).toBe(true);
    expect(same.evidenceDigest).toBe(state.evidenceDigest);
    expect(modelStatesEqual(state, reordered)).toBe(false);
    expect(reordered.evidenceDigest).not.toBe(state.evidenceDigest);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.modificationIds)).toBe(true);
  });

  it('uses an empty stack by default and validates every identity', () => {
    expect(defineModelState({ baseId: 'base:foundation' }).modificationIds).toEqual([]);
    expect(() =>
      defineModelState({ baseId: 'base:foundation', modificationIds: ['invalid id'] })
    ).toThrow(InvalidWorkbenchValueError);
  });
});
