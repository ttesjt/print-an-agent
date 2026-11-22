import { expect, it } from 'vitest';
import { defineTextTokenCounterConfig } from '../../../src/index.js';

function configurationFailure(input: unknown): unknown {
  try {
    defineTextTokenCounterConfig(input);
  } catch (cause: unknown) {
    return cause;
  }
  return undefined;
}

const variants = [
  { valid: { kind: 'tiktoken', encoding: 'cl100k_base' }, extra: { charactersPerToken: 4 } },
  {
    valid: { kind: 'character-estimator', charactersPerToken: 4 },
    extra: { encoding: 'cl100k_base' },
  },
  {
    valid: { kind: 'reference', measurementRef: 'test:counter' },
    extra: { encoding: 'cl100k_base' },
  },
];

it.each(variants)(
  'rejects incompatible fields in the first $valid.kind snapshot',
  ({ valid, extra }) => {
    const target = { ...valid, ...extra };
    let reads = 0;
    const input = new Proxy(target, {
      ownKeys: () => (++reads === 1 ? Reflect.ownKeys(target) : Object.keys(valid)),
    });
    expect(configurationFailure(input)).toMatchObject({
      code: 'TOKEN_MEASUREMENT_BINDING_INVALID',
    });
    expect(reads).toBe(1);
  }
);

it.each(variants)(
  'normalizes the valid first $valid.kind snapshot without rereading later changes',
  ({ valid, extra }) => {
    const target = { ...valid, ...extra };
    let reads = 0;
    const descriptors: PropertyKey[] = [];
    const input = new Proxy(target, {
      ownKeys: () => (++reads === 1 ? Object.keys(valid) : Reflect.ownKeys(target)),
      getOwnPropertyDescriptor(subject, key) {
        descriptors.push(key);
        return Reflect.getOwnPropertyDescriptor(subject, key);
      },
    });
    const result = defineTextTokenCounterConfig(input);
    expect(result).toEqual(valid);
    expect(Object.isFrozen(result)).toBe(true);
    expect(reads).toBe(1);
    expect(descriptors).toEqual(Object.keys(valid));
  }
);

it('retains inspection failure identity and cause', () => {
  const cause = new Error('inspection failed');
  const input = new Proxy(
    {},
    {
      ownKeys() {
        throw cause;
      },
    }
  );
  expect(configurationFailure(input)).toMatchObject({
    code: 'TOKEN_MEASUREMENT_BINDING_INVALID',
    cause,
  });
});

it('retains null-prototype data records and absent versus explicit undefined defaults', () => {
  const input = { kind: 'character-estimator' };
  Object.setPrototypeOf(input, null);
  expect(defineTextTokenCounterConfig(input)).toEqual({
    kind: 'character-estimator',
    charactersPerToken: 4,
  });
  expect(() => defineTextTokenCounterConfig({ ...input, charactersPerToken: undefined })).toThrow();
});
