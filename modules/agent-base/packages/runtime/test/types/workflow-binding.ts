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
    workflow,
    applyResult: (context, result) => {
      context.output = result;
    },
  });
  bindAgentWorkflow({
    workflow,
    // @ts-expect-error dependencies must be bound by the Workflow's constructor
    resources: () => undefined,
    applyResult: () => undefined,
  });
  // @ts-expect-error binding preserves the Workflow's result type
  const wrongResult: AgentWorkflow<Run, number> = bound;
  void wrongResult;
}
