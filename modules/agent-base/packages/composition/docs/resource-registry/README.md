# Composition Resource Registry

An optional, domain-neutral subsystem of `@ta-agent/base-composition`. A Blueprint chooses providers; a Scope
owns their acquisitions; a Registry resolves typed requests. Workflows/Steps receive explicit
capabilities, not the Registry. Generic application Services request capabilities through Definition
factories/resolvers; Profile-specific resource-resolution Services may directly use the Registry.
Resource acquisition and lifecycle ownership remain separate in both cases.

See the [consumer and lifecycle guide](./consumption.md) and its executable non-Agent
SQLite/Memory Bundle example. Run `pnpm test:base-composition-qualification` from the repository root
to qualify Composition, public consumers, and their dependency boundaries.

Tokens have opaque identity and invariant binding/value types. Their binding parser and value guard
let composition safely cross the heterogeneous registry boundary without trusting an erased cast.
Binding parsers and provider descriptors must be pure. Bindings are detached, immutable JSON-safe
snapshots, including well-formed Unicode; live handles belong in declared dependencies.

```ts
import {
  ResourceToken,
  compileResourceBlueprint,
  defineResourceProvider,
  createResourceScope,
} from '@ta-agent/base-composition/resource-registry';

const counter = new ResourceToken('counter', {
  parseBinding(input: unknown): string {
    if (typeof input !== 'string') throw new Error('Expected a counter identity.');
    return input;
  },
  isValue: (input: unknown): input is number => typeof input === 'number',
});
const blueprint = compileResourceBlueprint([
  defineResourceProvider({
    token: counter,
    dependencies: {},
    externalBinding: 'borrowed',
    describe: (id) => ({ key: id, descriptor: id }),
    create: () => ({ value: 1 }),
  }),
]);
```

Compilation is synchronous and does not call parsers, validators or factories. Duplicate providers,
missing dependencies and cycles fail before acquiring resources. The package does not select domain
adapters, run business commands or establish process-global caches.

```ts
const scope = createResourceScope(blueprint);
const count = await scope.registry.resolve(counter.request('main'));
await scope.close();
```

`lookup` never calls a provider factory; `resolve` uses only the declared provider. Keys and complete JSON
descriptors must agree on a hit. `undefined` is reserved for a lookup miss, not a legal resource
value. Thenable capability values/acquisition records are also invalid: async resolution must not
execute or unwrap a resource as a Promise. A provider itself may of course initialize asynchronously.
Providers receive only their resolved named dependencies, with no Registry access.

Keep the entire Scope while returned capabilities are in use. Canceling one waiter does not cancel
shared initialization. Before closing, the Host must drain actual business calls; Scope tracks only
initialization and explicit acquisitions. `close({ mode: 'abort' })` cancels initialization and joins
its real completion, not arbitrary operations on returned objects. Owned `release()` callbacks run
in reverse dependency order, at most once. Borrowed objects are not inferred by detecting `close()`.

Providers own partial-allocation unwind before returning an acquisition. Throw `ResourceCleanupError`
when unwind cannot be confirmed, retaining the original failure and cleanup causes. Failed attempts
remain in the ownership ledger even if never ready; their transitive dependencies are protected from
premature release. Other independent branches still close. A fenced/closed Scope cannot reopen, and
cleanup failure never changes a business commit receipt into a not-committed result.

Validation is a synchronous contract check, not an asynchronous health probe. An accidentally async
`validate` callback is joined before release, then rejected rather than silently accepted or left
running against closed dependencies. Release callbacks and validated values are captured once;
caller-owned resource instances are not frozen.

## External roots and Host reuse

A provider may explicitly allow `externalBinding: 'borrowed'`. Only roots with no declared
dependencies may be supplied: replacing a dependent would silently skip part of the owned graph.
An external aggregate Service/Bundle must therefore be an explicit root contract whose owner keeps
its entire hidden dependency closure alive. The Profile must preserve the same authority across
that aggregate and any other consumers; structural type similarity cannot prove this for it.

```ts
import { borrowResource, bindResourceScope } from '@ta-agent/base-composition/resource-registry';

// Requires counter's provider to explicitly allow borrowed binding.
const retained = createResourceScope(blueprint, {
  bindings: [borrowResource(counter.request('main'), 42)],
});
// Multiple composition factories may bind the same Blueprint/Scope, then inject narrow capabilities.
const resources = bindResourceScope(blueprint, retained);
const reused = await resources.lookup(counter.request('main')); // 42; no provider create
await retained.close();
```

Declarations are closed at Scope creation. Unknown/forbidden/dependent overrides, duplicate slots
and descriptor collisions fail synchronously. Identity wiring is detached; live objects are neither
cloned nor frozen. Validation runs only on first use (including lookup of a supplied value). Invalid
borrowed values are never delivered or released, and never fall back to a provider factory.

`bindResourceScope` requires the **same compiled Blueprint**, not a newly compiled lookalike or a
copied Registry object. Closing/fenced Scopes reject binding and resolution. Keep the whole Scope
across Host calls, or the whole caller-owned setup for a multi-allocation Profile. Do not import a
partial ready table. Reuse does not change the responsibility boundary: a Profile resource-resolution
Service may retain the bound Registry, while a generic Service keeps using its narrow Definition
provisioning contract and a Workflow keeps its explicit resources.

The external owner must outlive every consumer. Capturing a reference does not keep a connection,
worker or lease valid after that owner closes it. Host shutdown drains business work first, then
closes borrowing Scopes, and only after confirmed cleanup closes its external roots. A failed Scope
close must not be treated as permission to close borrowed dependencies that may still be in use.
Core provides no cross-Scope reference counting, ownership transfer, eviction or automatic business
drain. Business receipts and cleanup failures remain separate outcomes.
