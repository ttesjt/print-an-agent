import { AgentDefinitionError } from '../types/errors.js';
import type { AnyRunnableWorkflow, AgentWorkflowCatalog } from '../types/workflow-catalog.js';

export function createAgentWorkflowCatalog(
  workflows: readonly AnyRunnableWorkflow[]
): AgentWorkflowCatalog {
  const byName = new Map<string, AnyRunnableWorkflow>();

  for (const workflow of workflows) {
    if (workflow.name.length === 0) {
      throw new AgentDefinitionError(
        'WORKFLOW_NAME_INVALID',
        workflow.name,
        'Workflow names cannot be empty.'
      );
    }
    if (byName.has(workflow.name)) {
      throw new AgentDefinitionError(
        'WORKFLOW_NAME_DUPLICATE',
        workflow.name,
        `Workflow "${workflow.name}" is registered more than once.`
      );
    }
    byName.set(workflow.name, workflow);
  }

  const names = Object.freeze([...byName.keys()]);
  return Object.freeze({
    names,
    has: (workflow: AnyRunnableWorkflow) => byName.get(workflow.name) === workflow,
    get: (name: string) => byName.get(name),
  });
}
