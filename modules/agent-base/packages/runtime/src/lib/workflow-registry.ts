import { SKIP_WORKFLOW } from '../skip-workflow.js';
import type { AnyAgentRunContext } from '../types/context.js';
import { AgentDefinitionError } from '../types/errors.js';
import type { AgentWorkflow, WorkflowName } from '../types/workflow.js';
import type {
  ResolvedWorkflow,
  ResolvedWorkflowRegistry,
  WorkflowDefinitions,
  WorkflowOverrides,
} from '../types/workflow-registry.js';

export function resolveWorkflowRegistry<
  TWorkflowName extends WorkflowName,
  C extends AnyAgentRunContext,
>(
  definitions: WorkflowDefinitions<TWorkflowName, C>,
  overrides?: WorkflowOverrides<TWorkflowName, C>
): ResolvedWorkflowRegistry<TWorkflowName, C> {
  const appliedOverrides = overrides ?? ({} as WorkflowOverrides<TWorkflowName, C>);

  for (const workflowName of Object.keys(appliedOverrides)) {
    if (!Object.hasOwn(definitions, workflowName)) {
      throw new AgentDefinitionError(
        'WORKFLOW_OVERRIDE_UNKNOWN',
        workflowName,
        `Workflow override "${workflowName}" does not have a registered definition.`
      );
    }
  }

  const resolved = Object.create(null) as Record<TWorkflowName, ResolvedWorkflow<C>>;

  for (const workflowName of Object.keys(definitions) as TWorkflowName[]) {
    const registration = definitions[workflowName];
    const override = appliedOverrides[workflowName];

    if (override === SKIP_WORKFLOW) {
      if (!registration.skippable) {
        throw new AgentDefinitionError(
          'WORKFLOW_NOT_SKIPPABLE',
          workflowName,
          `Required workflow "${workflowName}" cannot be disabled by configuration.`
        );
      }

      resolved[workflowName] = Object.freeze({ status: 'skipped' });
      continue;
    }

    let workflow: AgentWorkflow<C> | undefined;
    if (override === undefined) {
      workflow = registration.workflow;
    } else {
      workflow = override;
    }

    if (workflow === undefined) {
      throw new AgentDefinitionError(
        'WORKFLOW_IMPLEMENTATION_MISSING',
        workflowName,
        `Workflow "${workflowName}" has no default implementation or explicit override.`
      );
    }

    if (workflow.name !== workflowName) {
      throw new AgentDefinitionError(
        'WORKFLOW_NAME_MISMATCH',
        workflowName,
        `Workflow registry key "${workflowName}" cannot resolve to workflow "${workflow.name}".`
      );
    }

    resolved[workflowName] = Object.freeze({ status: 'active', workflow });
  }

  return Object.freeze(resolved);
}
