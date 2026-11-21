# `@print-an-agent/agent-actor`

Agent-specific Actor permissions and Responsibility routing over
`@print-an-agent/model-invocation-core`. Workflow and Step retain execution-planning authority.

## Public contract and ownership

The package exposes one root entry with deliberate named exports. `defineAgentActor()` extends a
Core Actor definition with `allowedTools`. `createAgentActorCatalog()` delegates binding and
invocation to Core, while preserving those permissions and a required catalog revision in
`ResolvedAgentActor`. Core binding/protocol errors retain their Core identities; Agent-owned input
and routing failures use `AgentActorError`.

Generic Engine/Actor capabilities, invocation configuration and deadlines, cancellation, token
measurement, and event/result protocol integrity belong to
[Model Invocation](../../../model-invocation/README.md). Its
[Core contract](../../../model-invocation/packages/core/README.md) also owns technical requirement
validation. Responsibility definition maps Core's closed requirement diagnostics to its existing
Agent-specific error codes and messages.

Actor and Responsibility Tool lists default to empty and remain independent declarations. Request
composition supplies them to Agent Base Tool alongside product/runtime permissions; Tool owns the
final permission intersection, budgets and execution. This package selects no provider or storage.

## Responsibilities

A Responsibility registers a purpose, instructions, required technical capabilities and optional
ordered Actor candidates. The built-ins are `foreground-interaction` and `session-compaction`.
The configured main Actor must resolve before the Responsibility is read, even when an explicit
candidate list is present. Omitted candidates select the main Actor; an empty or all-disabled list
is unavailable. Selection chooses the first enabled compatible Actor. Missing enabled Actors and
Core errors propagate; invocation failure does not retry later candidates.

Selected invocations delegate to the same Core Actor. Instruction order is Actor, Responsibility,
then caller. Direct, interaction and optional streaming projection retain their Core capability and
cancellation boundaries. Responsibility and Actor catalog revisions are independent immutable
snapshots. Durable catalogs and automatic failover remain outside this package.

## Source ownership

```text
src/
  index.ts                        # Package aggregate; no additional npm subpaths
  errors.ts                       # Shared runtime error class
  types.ts                        # Shared error-code group
  actors/
    index.ts                      # Agent Actor feature API
    definition.ts                 # Core definition plus Agent permissions
    catalog.ts                    # Core catalog delegation and permission projection
    defaults.ts                   # Coordinated main-Actor default
    types/                        # Definition/resolved and catalog contracts
  responsibilities/
    index.ts                      # Responsibility feature API
    identifiers.ts                # Responsibility ID validation
    built-ins.ts                  # Built-in IDs and definitions
    definition.ts                 # Input normalization and domain diagnostics
    catalog.ts                    # Immutable definitions and catalog revision
    routing.ts                    # Main preflight and ordered candidate selection
    invocation.ts                 # Selected-Actor instruction/call projection
    types/                        # Definition/identity, catalog and routing contracts
```

Responsibilities consume Actors through `actors/index.ts`; Actors remain independent of
Responsibilities. Children consume the explicitly shared error modules, and those modules never
depend on a child. Independent types/interfaces stay in their owner's `types/`; the single shared
error-code group uses `types.ts`. Local implementation state stays with its algorithm.

## Verification

Run `pnpm test:agent-actor-qualification` from the repository root. It prepares dependencies and
checks types, lint, formatting, tests and declared source boundaries. Core-only definition tests
live in Core; Agent Actor tests cover permissions, catalogs and Responsibilities. Integration tests
consume compiled public exports and verify delegation to Core.

Test/watch/coverage commands prepare this package's initial build. During watch development run
`pnpm dev` alongside `pnpm test:watch` to rebuild the public output consumed by integration tests.
The shared source-boundary checker covers literal imports/re-exports, including type edges and
ancestor/shared entries. The shared type-module checker verifies runtime erasure. Computed module
paths and semantic ownership still require review. Independent tarball consumers run through
`pnpm release:prepare` and `pnpm release:verify`.

## Naming migration

This package replaces `@print-an-agent/base-actor`. Update the dependency and imports to
`@print-an-agent/agent-actor`; the former package has no compatibility wrapper.

| Previous Agent Base export  | Current export                   |
| --------------------------- | -------------------------------- |
| `ActorDefinitionInput`      | `AgentActorDefinitionInput`      |
| `ActorDefinition`           | `AgentActorDefinition`           |
| `ResolvedActor`             | `ResolvedAgentActor`             |
| `ActorCatalogPort`          | `AgentActorCatalogPort`          |
| `CreateActorCatalogOptions` | `CreateAgentActorCatalogOptions` |
| `createActorCatalog`        | `createAgentActorCatalog`        |

`defineAgentActor`, the Responsibility APIs, built-in IDs and error codes keep their names.
The package still exposes one root entry, depends only on Model Invocation Core and Agent Base Tool,
and belongs to Agent Base. Its invocation, permission and routing behavior is unchanged.
