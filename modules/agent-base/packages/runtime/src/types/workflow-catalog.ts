import type { AgentWorkflow } from './workflow.js';

export type AnyAgentWorkflow = AgentWorkflow<never>;

export interface AgentWorkflowCatalog {
  readonly names: readonly string[];
  has(workflow: AnyAgentWorkflow): boolean;
  get(name: string): AnyAgentWorkflow | undefined;
}
