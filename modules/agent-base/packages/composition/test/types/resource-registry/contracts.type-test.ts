import {
  defineResourceProvider,
  resourceDependency,
  ResourceToken,
  borrowResource,
  type ResourceRegistry,
} from '@print-an-agent/base-composition/resource-registry';

declare const registry: ResourceRegistry;
const count = new ResourceToken('count', {
  parseBinding: (input: unknown) => String(input),
  isValue: (value): value is number => typeof value === 'number',
});
const text = new ResourceToken('text', {
  parseBinding: (input: unknown) => String(input),
  isValue: (value): value is string => typeof value === 'string',
});
const numericBinding = new ResourceToken('numeric', {
  parseBinding: (input: unknown) => Number(input),
  isValue: (value): value is number => typeof value === 'number',
});
const result: Promise<number> = registry.resolve(count.request('key'));
void result;
// @ts-expect-error Different value types must remain invariant.
const invalidToken: typeof count = text;
void invalidToken;
// @ts-expect-error Different binding types cannot share a token.
const invalidBinding: typeof count = numericBinding;
void invalidBinding;
// @ts-expect-error Requests require the token's binding type.
count.request(1);
borrowResource(count.request('key'), 1);
// @ts-expect-error Supplied values cannot widen the request's invariant value type.
borrowResource(count.request('key'), 'not-a-number');
defineResourceProvider({
  token: text,
  dependencies: { count: resourceDependency(count, (parent: string) => parent) },
  describe: (binding) => ({ key: binding, descriptor: binding }),
  create: ({ dependencies }) => {
    const number: number = dependencies.count;
    // @ts-expect-error Providers receive the declared value, not an arbitrary dictionary.
    const string: string = dependencies.count;
    // @ts-expect-error No Registry or undeclared capabilities are available.
    void dependencies.registry;
    void string;
    return { value: String(number) };
  },
});
