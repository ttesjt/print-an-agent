import type { RunnableWorkflow } from './workflow.js';

export type AnyRunnableWorkflow = RunnableWorkflow<never>;

export interface AgentWorkflowCatalog {
  readonly names: readonly string[];
  has(workflow: AnyRunnableWorkflow): boolean;
  get(name: string): AnyRunnableWorkflow | undefined;
}
