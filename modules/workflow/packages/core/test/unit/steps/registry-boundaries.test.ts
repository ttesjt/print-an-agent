import { expect, it } from 'vitest';
import { resolveStepRegistry, mergeStepOverrides } from '@print-an-agent/workflow-core';

it.each(['toString', 'constructor', '__proto__'])(
  'does not read inherited overrides for the legal Step name %s',
  (name) => {
    const step = () => Promise.resolve();
    const definitions = {
      [name]: { step, skippable: false, cardinality: 'at-most-once' as const },
    };
    expect(resolveStepRegistry(definitions)[name]).toMatchObject({ step });
  }
);

it('rejects accessor maps without evaluating the getter', () => {
  let reads = 0;
  const definitions = {
    leaf: { step: () => Promise.resolve(), skippable: false, cardinality: 'at-most-once' as const },
  };
  const overrides = {
    get leaf() {
      reads++;
      return () => Promise.resolve();
    },
  };
  expect(() => resolveStepRegistry(definitions, overrides)).toThrow();
  expect(() => mergeStepOverrides(overrides)).toThrow();
  expect(() =>
    resolveStepRegistry({
      get leaf() {
        reads++;
        return definitions.leaf;
      },
    })
  ).toThrow();
  expect(reads).toBe(0);
});
