# `@ta-agent/base-workflow`

Agent orchestration, conditional Workflows, run-scoped Contexts, and replaceable Steps for Agent
Base.

The runtime has four levels:

```text
Agent
  → explicit Workflow Plan
      → Workflow
          → Step
```

An Agent owns identity, config, resources, a smart Workflow Registry, and a default plan. Every
`agent.run()` creates one Agent Context shared only by the Workflows selected for that run.

A Workflow is a reusable class with its own condition, Workflow Context factory, Step Registry, and
Step Executor. Every Workflow run creates an isolated Workflow Context. Leaf, composite, and entry
workflow Steps all have the same function shape and resolve nested calls through
`context.runStep()`.

Agent configuration may explicitly disable a registered skippable Workflow with `SKIP_WORKFLOW`.
An active Workflow may independently skip itself at run time through its internal condition. These
are distinct decisions.

```ts
const chat = new Workflow({
  name: 'chat',
  entryStep: 'workflow',
  stepDefinitions,
  createContext: (base) => ({ ...base, messages: [] }),
  condition: () => Promise.resolve(RUN_WORKFLOW),
  applyResult: async (agentContext, result) => {
    agentContext.output = result;
  },
});

const agent = new Agent({
  identity: defineAgentIdentity({ id: 'example', displayName: 'Example' }),
  config,
  resources,
  workflowPlan: ['chat'],
  workflowDefinitions: {
    chat: { workflow: chat, skippable: false },
  },
  createContext: (base) => ({ ...base }),
});
```

`createWorkflow()` and `createAgent()` are constructor conveniences. Subclassing is not required,
but classes remain available when a product benefits from a named domain type.

This package contains no provider, Pi, database, configuration schema, or product policy.
