export type WorkflowBundleDefinitionErrorCode =
  | 'WORKFLOW_BUNDLE_DEFINITION_INVALID'
  | 'WORKFLOW_BUNDLE_MEMBER_INVALID'
  | 'WORKFLOW_BUNDLE_RESOURCE_BINDING_FORBIDDEN';

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
