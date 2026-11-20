import type { RunnableWorkflow } from '@print-an-agent/workflow-core';

import type { AnyAgentRunContext } from '../../types/context.js';

export type WorkflowName = string;

/** A run-owned result application capability; not a second Workflow execution engine. */
export interface AgentWorkflowRun<C extends AnyAgentRunContext, TResult = unknown> {
  readonly result: TResult;
  readonly applyTo: (context: C) => Promise<void>;
}

export interface AgentWorkflow<C extends AnyAgentRunContext, TResult = unknown> {
  readonly name: WorkflowName;
  run(context: C): Promise<AgentWorkflowRun<C, TResult>>;
}

export interface AgentWorkflowBinding<C extends AnyAgentRunContext, TInput, TResult> {
  /** An assembled Workflow whose borrowed resources are already bound. */
  readonly workflow: RunnableWorkflow<TInput, TResult>;
  /** Selects synchronous input; top-level Promises/thenables are rejected before Workflow admission. */
  readonly projectInput: (context: C) => NoInfer<TInput>;
  readonly applyResult: (context: C, result: TResult) => void | Promise<void>;
}
