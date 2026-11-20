import type { WorkflowDefinitionErrorCode, WorkflowRunErrorCode } from './types/errors.js';

export class WorkflowDefinitionError extends Error {
  constructor(
    readonly code: WorkflowDefinitionErrorCode,
    readonly subjectName: string,
    message: string
  ) {
    super(message);
    this.name = 'WorkflowDefinitionError';
  }
}
export class WorkflowRunError extends Error {
  constructor(
    readonly code: WorkflowRunErrorCode,
    message: string,
    readonly subjectName?: string
  ) {
    super(message);
    this.name = 'WorkflowRunError';
  }
}
