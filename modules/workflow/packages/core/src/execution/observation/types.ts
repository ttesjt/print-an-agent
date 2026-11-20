import type { WorkflowEventReference } from '../../contracts/index.js';

/** Synchronous, observational mapping to a public code; never return messages or secrets. */
export type WorkflowFailureClassifier = (error: unknown) => string | undefined;

interface FailureMetadata {
  /** Optional uppercase ASCII identifier, matching [A-Z][A-Z0-9_]{0,127}. */
  readonly errorCode?: string;
}

/** Metadata only: no input, state, resources, result, or raw error objects. */
export type WorkflowEvent = WorkflowEventReference &
  (
    | { readonly type: 'workflow-started' | 'workflow-completed' }
    | ({ readonly type: 'workflow-failed' } & FailureMetadata)
    | { readonly type: 'workflow-skipped'; readonly reason: string }
    | ({
        readonly stepName: string;
        readonly invocationId: string;
      } & (
        | { readonly type: 'step-started' | 'step-completed' | 'step-skipped' }
        | ({ readonly type: 'step-failed' } & FailureMetadata)
      ))
  );
/** Called in emission order; asynchronous observers are not awaited and cannot delay cleanup. */
export type WorkflowObserver = (event: WorkflowEvent) => void | Promise<void>;

type FailureReference =
  | Omit<Extract<WorkflowEvent, { type: 'workflow-failed' }>, 'errorCode'>
  | Omit<Extract<WorkflowEvent, { type: 'step-failed' }>, 'errorCode'>;

export interface WorkflowEventEmitter {
  readonly emit: (event: WorkflowEvent) => void;
  readonly fail: (event: FailureReference, error: unknown) => void;
}
