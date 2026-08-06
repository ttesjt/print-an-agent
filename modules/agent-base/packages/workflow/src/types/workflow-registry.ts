import type { AnyAgentContext } from './context.js';
import type { RunnableWorkflow, WorkflowName } from './workflow.js';

export interface WorkflowRegistration<C extends AnyAgentContext> {
  readonly workflow?: RunnableWorkflow<C>;
  readonly skippable: boolean;
}

export type WorkflowDefinitions<
  TWorkflowName extends WorkflowName,
  C extends AnyAgentContext,
> = Readonly<Record<TWorkflowName, WorkflowRegistration<C>>>;

export type SkipWorkflow = typeof import('../skip-workflow.js').SKIP_WORKFLOW;

export type WorkflowOverride<C extends AnyAgentContext> =
  | RunnableWorkflow<C>
  | SkipWorkflow
  | undefined;

export type WorkflowOverrides<
  TWorkflowName extends WorkflowName,
  C extends AnyAgentContext,
> = Readonly<Partial<Record<TWorkflowName, WorkflowOverride<C>>>>;

export type ResolvedWorkflow<C extends AnyAgentContext> =
  | Readonly<{ status: 'active'; workflow: RunnableWorkflow<C> }>
  | Readonly<{ status: 'skipped' }>;

export type ResolvedWorkflowRegistry<
  TWorkflowName extends WorkflowName,
  C extends AnyAgentContext,
> = Readonly<Record<TWorkflowName, ResolvedWorkflow<C>>>;
