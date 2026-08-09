# `@ta-agent/base-workflow`

Agent orchestration, conditional Workflows, run-scoped Contexts, and replaceable Steps for Agent
Base.

The runtime has five execution levels:

```text
Agent
  → Agent Operation
      → Agent Run
          → Workflow
              → Step
```

An Agent is the sole owner of identity, global resources, an immutable Workflow Catalog, and a typed
Agent Operation Catalog. An Agent Operation is a static named capability definition with public or
internal exposure, typed input/output, local config/resources, a Context factory, an ordered
Workflow plan, and an explicit set of callable Operation references. Every `agent.invoke()` creates
one isolated Agent Run and `BaseAgentRunContext`. The runtime records Agent Run, Workflow, and nested
Step lifecycle metadata through `@ta-agent/base-observability` without exposing Context values.

A Workflow is a reusable class with its own condition, Workflow Context factory, Step Registry, and
Step Executor. Every Workflow run creates an isolated Workflow Context. Leaf, composite, and entry
workflow Steps all have the same function shape and resolve nested calls through
`context.runStep()`.

An active Workflow may skip itself through its internal condition. Step and Workflow registry
utilities remain available to composition code that needs validated override/skip resolution, but
the Agent-owned Workflow Catalog contains only concrete immutable Workflow definitions. Operations
reference those definitions directly, and the Agent rejects different definitions that reuse one
Workflow name.

```ts
const chat = new Workflow({
  name: 'chat',
  entryStep: 'workflow',
  stepDefinitions,
  createContext: (base) => ({ ...base, messages: [] }),
  condition: () => Promise.resolve(RUN_WORKFLOW),
  applyResult: async (agentRunContext, result) => {
    agentRunContext.output = result;
  },
});

const foreground = defineAgentOperation({
  name: 'foreground',
  exposure: 'public',
  workflowPlan: [chat],
  config,
  resources,
  createContext: (base) => ({ ...base, messages: [] }),
});

const agent = createAgent({
  identity: defineAgentIdentity({ id: 'example', displayName: 'Example' }),
  resources,
  operations: { foreground },
});

const response = await agent.invoke('foreground', input);
```

Operation-to-Operation visibility is deny-by-default. `defineAgentOperationReference()` supports
forward declarations; an Operation receives only the narrowed invoker described by its
`callableOperations`. Child calls create distinct correlated Runs, inherit cancellation unless
explicitly overridden, and fail closed on undeclared targets or invocation cycles.

An Operation may also own bounded `prepareRun` and `mapRunError` policies. Preparation can normalize
its input or derive the runtime signal before Context creation; error mapping establishes its public
terminal failure contract. These hooks are part of the Operation lifecycle, so raw `agent.invoke()`
remains behavior-complete without an application facade.

`createWorkflow()` and `createAgent()` are constructor conveniences. Subclassing is not required,
but classes remain available when a product benefits from a named domain type.

Tracing is fail-open: an observability sink cannot replace an execution result or failure. This
package contains no provider, Pi, database, configuration schema, or product policy.
