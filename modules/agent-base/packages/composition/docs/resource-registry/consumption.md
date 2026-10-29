# Consuming scoped resources

Registry is an optional subsystem exposed by `@ta-agent/base-composition/resource-registry`.
It assembles reusable capabilities; it does not replace
the application's provisioning contracts, become Workflow resources, or own business execution.

## Workflow, Service and provisioning contracts

A Workflow is a capability implementation and execution plan. It declares explicit resources and
need not know their Profile, Tokens, bindings or ownership mechanism. A Step uses those capabilities,
not the Registry. Explicit resources can include narrow on-demand methods; independence from
composition does not require eager creation of every possible dependency.

A Service is an application entry/coordinator. It can resolve a target, validate input, acquire the
capabilities needed by this operation, call Workflows or other public capabilities, and project a
result. It may wrap a Workflow, but there is no one-to-one correspondence or requirement to do so.

Two responsibilities have different acquisition boundaries:

| Responsibility                                        | Default acquisition contract                                                    | Must not do                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Generic application/management Service                | Narrow typed factory/resolver declared by Definition                            | Choose a concrete Profile's Tokens, bindings, adapters or cache policy                   |
| Profile-specific assembly/resource-resolution Service | May directly use Registry to execute that Profile's declared recipe             | Register/replace Providers at run time, invent fallback recipes, or assume it owns Scope |
| Workflow/Step                                         | Explicit resources/capabilities, including narrow on-demand methods when needed | Locate resources through Registry or depend on a Profile                                 |

The distinction is responsibility, not a class/file suffix. Do not introduce a universal
`ResourceAccessService` merely to rename Registry calls. A meaningful resource-resolution Service
encapsulates a specific Profile's binding/identity/namespace policy. Services can explicitly compose
another Service's public interface or narrow capability; they cannot steal its internal adapter.

| Concept            | Contract and owner                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Definition         | Code-level blueprint and typed provisioning seams; no eager I/O or arbitrary live resource bag                   |
| Profile            | Concrete implementations, bindings, authority identity, sharing and ownership policy                             |
| Provisioner        | Implements typed acquisition contracts; may be functions or a Profile-specific Service, with or without Registry |
| Resource Blueprint | Fixed Provider recipes, named dependencies and permitted external roots compiled by the Profile                  |
| Registry           | Executes declared lookup/resolve within one Scope; does not select a new recipe                                  |
| Scope              | Owns acquisitions, initialization attempts and dependency-aware cleanup; Host/Profile owns its lifetime          |

Existing Agent Base contracts are examples, not new universal abstractions:
`runtime.createPorts(input)` and `sessionManagement.createPorts(namespace)` can resolve on demand.
The authority factory remains synchronous and returns already-prepared Ports. Adding Registry does
not silently make that factory async or force simple reopenable adapters into a Scope.

The executable [Service provisioning example](../../../../tests/integration/test/resource-registry/examples/service-provisioning)
contains a neutral Workflow Bundle, a generic document-management Service, a second Service using
only its public read capability, and a Profile-specific resource-resolution Service holding Registry.
Its small Definition belongs to the example, not a new public framework API. The same generic Service
also works with a direct factory and no Registry.

## Ownership in one picture

```text
Host owns Scope (or a multi-allocation Profile's entire setup)
  └─ compiled Blueprint → named Providers → acquisitions and their dependencies
       ├─ store / client / counter / model capabilities
       └─ Service or Workflow Bundle, with explicit borrowed dependencies
            └─ independent business calls and Workflow Runs, owned by Host
```

Definition/Profile chooses implementations and identity. Providers receive only declared named
dependencies. Generic Services use Definition provisioning contracts; Profile resource-resolution
Services may hold Registry. Workflows/Steps receive explicit capabilities. Resolving a resource does
not transfer ownership to either kind of Service.

## Executable Memory composition

The non-Agent [composition example](../../../../tests/integration/test/resource-registry/examples/memory-composition.ts)
uses public packages only. Its local `defineMemoryRecipe`, `compileMemoryRecipe`, and
`bindMemoryFactories` helpers belong to that example, **not** Core's API. It declares separate
resources for:

- a real Context Memory SQLite store;
- a complete Retrieval Memory SQLite backend (content, index, receipts, and worker);
- a text counter, Completion capability, Embedding capability, and chunker;
- native Context and Retrieval Workflow Bundles.

It does not combine the Memory domains or change their Workflow resources. A small derived object
such as `MemoryMeter` need not be another registered resource. Bundle construction runs no business
mutations. Counter/model resources can be shared while each Run retains its own input, state,
result, signal, and request identity.

Local paths are this example's adapter choice, not Registry requirements. One store holds multiple
`memoryId` documents/spaces. Remote adapters or a different capability graph belong in the Profile
recipe, not in Core or the Memory workflows.

## Compose once, retain the owner

Compile a Blueprint once. Create a Scope, then bind composition factories using
`bindResourceScope(blueprint, scope)`. Multiple Definition objects/factories may use that same Scope.
Keep the entire Scope alive for as long as any returned capability is being used.

```ts
const scope = createResourceScope(blueprint);
const resources = bindResourceScope(blueprint, scope);
const capability = await resources.resolve(token.request(binding));
// Inject the capability into a Workflow, or expose it through a narrow Definition resolver.
// A Profile resource-resolution Service may retain resources; it does not own scope.close().
```

Keys are `(Scope, Token identity, provider key)`; matching keys must also have matching descriptors.
Identity inputs are immutable JSON snapshots, not live handles, per-call signals, or credentials
resolved through global state. Descriptor data is not a logging payload. Choose persistent authority
identity independently of transient Config revision or runtime generation.

A newly compiled lookalike Blueprint cannot bind an old Scope. Changing a Provider requires a new
Scope and explicit Host transition. Registry has no replace, eviction, reopen, hot-reload, or partial
ready-table import. Agent Base's `AgentRuntimeService.open()` still creates a fresh raw Agent;
Registry sharing does not turn it into a generation cache.

For Standalone's ephemeral Memory Profile, retain `createStandaloneMemorySetup()` instead of an
individual allocation Scope. That setup compiles once and owns every allocation, including failed,
unpublished ones. Stage prepares authority before returning the handle; synchronous authority
factories return prepared Ports. Session persistence is lazy after publication. Namespace publish
does not transfer ownership, and abort permits same-ID retry only after confirmed cleanup.

## External borrowing is explicit

```ts
const scope = createResourceScope(blueprint, {
  bindings: [borrowResource(token.request(binding), externallyOwnedCapability)],
});
```

The Provider must explicitly allow `externalBinding: 'borrowed'` and have no declared dependencies.
Registration checks structure/permission/identity synchronously; first use validates the value,
including lookup of a registered external value. Lookup never invokes a Provider factory. Invalid
external values never fall back to local construction. Unknown, duplicate, conflicting, or dependent
overrides fail. Live supplied objects are not cloned or frozen, and Scope never releases them.

An external aggregate Bundle/Service is possible only as an explicit root contract. Its owner must
retain its whole dependency closure, and the Profile must ensure other consumers see the same
authority. Do not override a dependent Provider while silently skipping its dependencies.

A stored JavaScript reference does not keep a database connection, worker, or lease valid after its
owner closes it. Borrowed roots must outlive every consumer. If a borrowing Scope's cleanup is
unconfirmed, the external owner must not close a dependency still potentially in use. There is no
automatic cross-Scope reference counting or ownership transfer.

## On-demand use versus retained dependencies

A resolver is a dependency boundary, not a lifetime guarantee. A generic Service can acquire a
capability for one call, use it, and return its result. Host business admission/join covers that use.
If it returns a live handle or retains work after the call, Host must cover the longer lifetime too.

If a registered Service/Bundle retains a capability and may use it during release, declare that
dependency in its Provider graph before publishing the acquisition. Capturing it in a callback,
resolving it earlier through another Service, or keeping the resolver itself does not add a ledger
edge. Release uses the already-resolved dependency; it must not resolve new resources while closing.
Unconfirmed cleanup must continue protecting that dependency and its transitive closure. Dependencies
outside the graph require explicit external ownership of their entire lifetime, not an implicit
claim that Registry manages them. Core does not discover closures or add dynamic dependency edges.

On-demand acquisition, Scope-level instance reuse, independent Workflow execution, and lifecycle
ownership are four separate contracts. In particular, a Service holding Registry is not a Scope
owner, and two calls sharing a Bundle do not share Run state, signal or result.

## Shutdown and failure recovery

1. Host stops new business admission.
2. Host cancels if appropriate and joins actual business calls, streams, and model operations.
3. Host closes its Scope/setup, separately recording cleanup success/failure.
4. Only after confirmed consumer cleanup may Host close borrowed external dependencies.

`scope.close({ mode: 'abort' })` cancels and joins **initialization**, not arbitrary methods on
already returned objects. Canceling one resolution waiter stops its wait, not shared initialization.
A noncooperative operation must not be reported drained because a timeout elapsed.

Providers return `{ value, release? }`. Release owns only that acquisition, not injected dependencies.
Core captures it before validation and invokes it at most once, in reverse dependency order. It never
infers ownership from a `close`/`dispose` method. Initialization must unwind partial allocations before
throwing. If unwind cannot be confirmed, throw `ResourceCleanupError` with original and cleanup causes.
Map adapter-specific initialization cleanup errors at the composition boundary, not by adding domain
knowledge to Core.

Failed/unconfirmed attempts protect their transitive dependencies even if no value was ever ready.
Independent branches can still close. Fenced/closed Scopes cannot accept new work; repeated close
joins the same result and does not retry failed release. Admission fencing cannot revoke a capability
already held by application code; the Host still owns its business lifecycle.

Business outcome and resource cleanup outcome are separate facts. A completed Memory mutation's
receipt remains committed if Scope close later fails. Never replay a model call simply because cleanup
failed. After lost delivery, query the domain's durable receipt using its request identity; replay the
same request only according to that domain's idempotency contract. Closing/reopening a Scope is not a
commit protocol, rollback, or permission to forget a poisoned adapter.

The [public consumer tests](../../../../tests/integration/test/resource-registry) cover real SQLite reopen/recovery,
separate Run cancellation, CAS/replanning, Provider/Bundle replacement, external lease misuse, and
Host drain with a committed response plus independent cleanup failure.

## Verification

`pnpm test:base-composition-qualification` builds public dependencies and runs Composition contracts,
public consumers, typecheck, lint, format, and architecture isolation. Model fixtures use formal
Completion/Embedding protocols with deterministic implementations; they are not external-model quality
or performance claims. Memory, Workflow, Model Invocation, Agent Base, and hosts retain their own
qualification suites.
