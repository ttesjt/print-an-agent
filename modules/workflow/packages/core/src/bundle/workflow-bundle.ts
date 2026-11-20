import { Workflow, type RunnableWorkflow } from '../workflow/index.js';
import { readMember } from './member-definition.js';
import { readRecord } from './records.js';
import { WorkflowBundleDefinitionError } from './errors.js';
import type { BundleWorkflows, WorkflowBundleOptions } from './types.js';

export class WorkflowBundle<R, const D extends object> {
  readonly #workflows: BundleWorkflows<D>;

  constructor(options: WorkflowBundleOptions<R, D>) {
    const config = readRecord(options, 'WORKFLOW_BUNDLE_DEFINITION_INVALID', [
      'resources',
      'workflows',
    ]);
    if (!Object.hasOwn(config, 'resources') || !Object.hasOwn(config, 'workflows')) {
      throw new WorkflowBundleDefinitionError(
        'WORKFLOW_BUNDLE_DEFINITION_INVALID',
        'Resources and workflows must be provided at assembly.'
      );
    }
    const definitions = readRecord(config.workflows, 'WORKFLOW_BUNDLE_DEFINITION_INVALID');
    const workflows: Record<string, RunnableWorkflow<unknown, unknown>> = Object.create(
      null
    ) as Record<string, RunnableWorkflow<unknown, unknown>>;
    for (const [key, value] of Object.entries(definitions)) {
      workflows[key] = new Workflow({ ...readMember(value, key), resources: config.resources });
    }
    // All own keys were assembled once with the shared binding; retain their checked public types.
    this.#workflows = Object.freeze(workflows) as BundleWorkflows<D>;
  }

  get workflows(): BundleWorkflows<D> {
    return this.#workflows;
  }
}
