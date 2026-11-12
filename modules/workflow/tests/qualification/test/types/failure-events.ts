import type {
  WorkflowEvent,
  WorkflowFailureClassifier,
  WorkflowRunOptions,
} from '@print-an-agent/workflow-core';

export const classifier: WorkflowFailureClassifier = (error) =>
  error instanceof Error ? 'DOMAIN_FAILURE' : undefined;

export const options: WorkflowRunOptions<void> = {
  input: undefined,
  classifyFailure: classifier,
};

// @ts-expect-error Classification must be synchronous; async results are not public metadata.
export const asynchronous: WorkflowFailureClassifier = () => Promise.resolve('FAILURE');
// @ts-expect-error Classifiers cannot pass raw error objects to observers.
export const unsafe: WorkflowFailureClassifier = () => new Error('private');

// Compile-only: failure metadata requires narrowing and cannot be modified or expanded.
export function inspect(event: WorkflowEvent): string | undefined {
  if (event.type === 'step-failed' || event.type === 'workflow-failed') {
    // @ts-expect-error Event metadata is readonly.
    event.errorCode = 'CHANGED';
    // @ts-expect-error Raw errors are not part of the public event protocol.
    void event.error;
    return event.errorCode;
  }
  // @ts-expect-error Successful or skipped events do not carry failure codes.
  void event.errorCode;
  return undefined;
}
