import {
  compileResourceBlueprint,
  defineResourceProvider,
  resourceDependency,
  ResourceToken,
} from '@ta-agent/base-composition/resource-registry';
import { describe, expect, it, vi } from 'vitest';

const binding = (input: unknown): string => {
  if (typeof input !== 'string') throw new Error('Expected string');
  return input;
};
const value = (input: unknown): input is number => typeof input === 'number';
const token = (name: string) => new ResourceToken(name, { parseBinding: binding, isValue: value });

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
    expect.fail('Expected a resource error.');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('Resource Blueprint', () => {
  it('compiles synchronously without running contracts or factories or freezing caller objects', () => {
    const parse = vi.fn(binding);
    const isValue = vi.fn(value);
    const key = new ResourceToken('store', {
      parseBinding: parse,
      isValue: (input): input is number => isValue(input),
    });
    const describe = vi.fn((key: string) => ({ key, descriptor: key }));
    const create = vi.fn(() => ({ value: 1 }));
    const input = { token: key, describe, dependencies: {}, create };
    const provider = defineResourceProvider(input);
    const blueprint = compileResourceBlueprint([provider]);
    expect(Object.isFrozen(blueprint)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.dependencies)).toBe(false);
    for (const callback of [parse, isValue, describe, create])
      expect(callback).not.toHaveBeenCalled();
  });

  it('uses opaque token and blueprint identities', () => {
    const a = token('same');
    const b = token('same');
    const providers = [a, b].map((token) =>
      defineResourceProvider({
        token,
        dependencies: {},
        describe: (key) => ({ key, descriptor: key }),
        create: () => ({ value: 1 }),
      })
    );
    expect(compileResourceBlueprint(providers)).not.toBe(compileResourceBlueprint(providers));
  });

  it('rejects duplicate providers and missing dependencies', () => {
    const first = token('first');
    const second = token('second');
    const provider = defineResourceProvider({
      token: first,
      dependencies: { second: resourceDependency(second, (key: string) => key) },
      describe: (key) => ({ key, descriptor: key }),
      create: () => ({ value: 1 }),
    });
    expectCode(() => compileResourceBlueprint([provider, provider]), 'RESOURCE_BLUEPRINT_INVALID');
    expectCode(() => compileResourceBlueprint([provider]), 'RESOURCE_BLUEPRINT_INVALID');
  });

  it('rejects cycles, including otherwise unused bindings', () => {
    const a = token('a');
    const b = token('b');
    const providers = [
      [a, b],
      [b, a],
    ].map(([own, dependency]) => {
      if (own === undefined || dependency === undefined) throw new Error('Test fixture');
      return defineResourceProvider({
        token: own,
        dependencies: { other: resourceDependency(dependency, (key: string) => key) },
        describe: (key) => ({ key, descriptor: key }),
        create: () => ({ value: 1 }),
      });
    });
    expectCode(() => compileResourceBlueprint(providers), 'RESOURCE_DEPENDENCY_CYCLE');
  });

  it('copies request identity and refuses accessors, cycles and malformed Unicode', () => {
    const objectToken = new ResourceToken('object', {
      parseBinding: (input) => input,
      isValue: value,
    });
    const input = { id: 'first', nested: { revision: 1 } };
    const request = objectToken.request(input);
    input.nested.revision = 2;
    expect(request.binding).toEqual({ id: 'first', nested: { revision: 1 } });
    const getter = vi.fn(() => 'secret');
    expect(() =>
      objectToken.request({
        get id() {
          return getter();
        },
      })
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const invalid of [
      cycle,
      { id: '\ud800' },
      { number: Infinity },
      new Date(),
      [undefined],
    ]) {
      expect(() => objectToken.request(invalid)).toThrow();
    }
  });

  it('rejects unexpected wiring fields without evaluating getters', () => {
    const getter = vi.fn();
    const input = {
      token: token('strict'),
      dependencies: {},
      describe: (key: string) => ({ key, descriptor: key }),
      create: () => ({ value: 1 }),
      unexpected: true,
    };
    expectCode(() => defineResourceProvider(input), 'RESOURCE_BLUEPRINT_INVALID');
    const dependencyInput = {
      ...input,
      get dependencies() {
        getter();
        return {};
      },
    };
    expectCode(() => defineResourceProvider(dependencyInput), 'RESOURCE_BLUEPRINT_INVALID');
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not execute a getter used as a Provider list element', () => {
    const getter = vi.fn();
    const providers = new Array<ReturnType<typeof defineResourceProvider>>(1);
    Object.defineProperty(providers, 0, { enumerable: true, get: getter });
    expectCode(() => compileResourceBlueprint(providers), 'RESOURCE_BLUEPRINT_INVALID');
    expect(getter).not.toHaveBeenCalled();
  });
});
