# @print-an-agent/workflow-bundle

Assemble named Core Workflows over one borrowed Resources binding. Each member keeps its own input,
state, result projection, Step registry, overrides, executor and lifecycle. Execution uses
`@print-an-agent/workflow-core`.

```ts
import { WorkflowBundle, type BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';

interface Reader {
  read(key: string, signal: AbortSignal): Promise<string>;
}
interface Store extends Reader {
  write(key: string, value: string, signal: AbortSignal): Promise<void>;
}

type ReadState = { readonly key: string; text: string };
const inspect: BundleWorkflowDefinition<'read', string, ReadState, Reader, string> = {
  name: 'store.read',
  entryStep: 'read',
  createState: ({ input }) => ({ key: input, text: '' }),
  createResult: ({ text }) => text,
  stepDefinitions: {
    read: {
      skippable: false,
      cardinality: 'at-most-once',
      step: async (context) => {
        context.state.text = await context.resources.read(context.state.key, context.signal);
      },
    },
  },
};
const update: BundleWorkflowDefinition<
  'write',
  { key: string; value: string },
  { key: string; value: string },
  Store,
  void
> = {
  name: 'store.write',
  entryStep: 'write',
  createState: ({ input }) => ({ key: input.key, value: input.value }),
  createResult: () => undefined,
  stepDefinitions: {
    write: {
      skippable: false,
      cardinality: 'at-most-once',
      step: async (context) => {
        await context.resources.write(context.state.key, context.state.value, context.signal);
      },
    },
  },
};

const values = new Map<string, string>();
const resources: Store = {
  read: (key, signal) => {
    signal.throwIfAborted();
    return Promise.resolve(values.get(key) ?? '');
  },
  write: (key, value, signal) => {
    signal.throwIfAborted();
    values.set(key, value);
    return Promise.resolve();
  },
};
const bundle = new WorkflowBundle({ resources, workflows: { inspect, update } });
await bundle.workflows.update.run({ input: { key: 'one', value: 'Hello' } });
const text: string = await bundle.workflows.inspect.run({ input: 'one' });
```

`BundleWorkflowDefinition<StepName, Input, State, Resources, Result>` is a Core definition without a
Resources binding. The constructor checks that its Resources satisfy every member's requirements;
the reader above declares a narrower interface but receives exactly the same object as the writer.
Required capabilities are checked by TypeScript. Runtime validation checks configuration structure,
not the business behavior of adapters or callbacks.

## Assembly and reuse

Pass complete definitions, not preassembled Workflow instances or factories. A member's own
`resources` field is rejected, even when its value is `undefined`. Optional configuration such as
`stepOverrides`, `executeStep`, `condition`, `createSkippedResult`, lifecycle hooks and `createRunId`
remains on each member.
Shared Step functions only need to accept the Context fields they actually use. There is no global
Step registry or Bundle-wide override layer.

`bundle.workflows` is a read-only, frozen snapshot with own keys and no inherited members. Each value
is one real Core Workflow, created synchronously at assembly and reused on every call. The key is an
alias; `bundle.workflows.inspect.name` remains `store.read`. An empty collection is allowed. Maps and
definitions must be plain records with enumerable string data properties; accessors and symbol keys
are rejected. Core keeps its existing validation of Step definitions and policies.

Definitions can also be used directly with Core:

```ts
import { Workflow } from '@print-an-agent/workflow-core';

const standalone = new Workflow({ ...inspect, resources });
await standalone.run({ input: 'one' });
```

Assembly never invokes Steps, conditions, state/result factories or lifecycle hooks. No partial
Bundle is returned if a member is invalid. No connection is acquired, and borrowed resources are not
closed when construction fails. Replacing the original definition or member-map fields afterward does
not change the assembled Workflows. Resource objects and executable closures are not deep-frozen or
cloned; shared mutation and adapter concurrency remain the consumer's responsibility.

## Execution and ownership

Call members with the normal Core `run()` options: `input`, optional `signal`, `parentRunId`, `onEvent`
and `classifyFailure`. Each invocation has independent state, result, Run identity, Step counts,
cancellation and observation. Cancelling or failing one call does not cancel sibling calls. Each
Workflow still drains its own admitted Steps before lifecycle hooks or returning.

The Bundle has no overall Run, automatic sibling cancellation, transaction, retry policy, or implicit
cross-Workflow invocation. There is no extra dispatch protocol: results and failures come directly
from each member. A member's Core definition error remains a `WorkflowDefinitionError`; Bundle
configuration failures use `WorkflowBundleDefinitionError` and its `code` and optional `memberName`.

Resource ownership stays with the host. Acquired transactions and leases retain their own protected
release scope; injected shared adapters stay open across successful, skipped, failed and cancelled
calls. Await every active invocation before closing shared resources. A durable commit is not rolled
back by a later hook failure; read the authoritative store to learn the persisted result.

The [SQLite consumer](../../tests/qualification/test/consumers/record-bundle.ts) reuses the same update
definition independently and in a Bundle, then qualifies persistence, CAS and cancellation through
public package exports. Run `pnpm test:workflow-qualification` from the repository root.
