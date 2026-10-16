import type { AnyAgentRunContext } from './context.js';
import type { AgentWorkflow, WorkflowName } from './workflow.js';

export interface WorkflowRegistration<C extends AnyAgentRunContext> {
  readonly workflow?: AgentWorkflow<C>;
  readonly skippable: boolean;
}

export type WorkflowDefinitions<
  TWorkflowName extends WorkflowName,
  C extends AnyAgentRunContext,
> = Readonly<Record<TWorkflowName, WorkflowRegistration<C>>>;

export type SkipWorkflow = typeof import('../skip-workflow.js').SKIP_WORKFLOW;

export type WorkflowOverride<C extends AnyAgentRunContext> =
  | AgentWorkflow<C>
  | SkipWorkflow
  | undefined;

export type WorkflowOverrides<
  TWorkflowName extends WorkflowName,
  C extends AnyAgentRunContext,
> = Readonly<Partial<Record<TWorkflowName, WorkflowOverride<C>>>>;

export type ResolvedWorkflow<C extends AnyAgentRunContext> =
  | Readonly<{ status: 'active'; workflow: AgentWorkflow<C> }>
  | Readonly<{ status: 'skipped' }>;

export type ResolvedWorkflowRegistry<
  TWorkflowName extends WorkflowName,
  C extends AnyAgentRunContext,
> = Readonly<Record<TWorkflowName, ResolvedWorkflow<C>>>;
