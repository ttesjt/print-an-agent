import type { WorkflowBundleDefinitionErrorCode } from './types.js';

export class WorkflowBundleDefinitionError extends Error {
  constructor(
    readonly code: WorkflowBundleDefinitionErrorCode,
    message: string,
    readonly memberName?: string
  ) {
    super(message);
    this.name = 'WorkflowBundleDefinitionError';
  }
}
