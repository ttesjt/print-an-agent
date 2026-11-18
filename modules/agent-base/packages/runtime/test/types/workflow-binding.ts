import type { RunnableWorkflow } from '@print-an-agent/workflow-core';
import {
  bindAgentWorkflow,
  type AgentWorkflow,
  type BaseAgentRunContext,
} from '../../src/index.js';

type Run = BaseAgentRunContext<string, string>;

// Compile-only contracts: binding adds Run semantics to an already-assembled Workflow.
export function verifyBinding(workflow: RunnableWorkflow<Run, string>): void {
  const bound: AgentWorkflow<Run, string> = bindAgentWorkflow({
    projectInput: (context: Run) => context,
    workflow,
    applyResult: (context, result) => {
      context.output = result;
    },
  });
  bindAgentWorkflow({
    projectInput: (context: Run) => context,
    workflow,
    // @ts-expect-error dependencies must be bound by the Workflow's constructor
    resources: () => undefined,
    applyResult: () => undefined,
  });
  // @ts-expect-error binding preserves the Workflow's result type
  const wrongResult: AgentWorkflow<Run, number> = bound;
  void wrongResult;
}

interface BusinessInput {
  readonly message: string;
}

export function verifyProjectedBinding(workflow: RunnableWorkflow<BusinessInput, string>): void {
  const bound: AgentWorkflow<Run, string> = bindAgentWorkflow({
    workflow,
    projectInput: (run: Run) => ({ message: run.input }),
    applyResult: (run, result) => {
      run.output = result;
    },
  });
  // @ts-expect-error The binding is invoked with an Agent Run, not the projected business input.
  void bound.run({ message: 'input' });
  bindAgentWorkflow({
    workflow,
    // @ts-expect-error The Workflow determines the accepted input; projection cannot widen it.
    projectInput: (run: Run) => ({ message: run.input.length }),
    applyResult: () => undefined,
  });
  bindAgentWorkflow({
    workflow,
    // @ts-expect-error An unrelated projection cannot change the Workflow's input type.
    projectInput: (run: Run) => run,
    applyResult: () => undefined,
  });
  bindAgentWorkflow({
    workflow,
    // @ts-expect-error This Workflow requires a value, not an asynchronous input factory.
    projectInput: async (run: Run) => ({ message: await Promise.resolve(run.input) }),
    applyResult: () => undefined,
  });
}
