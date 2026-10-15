import type {
  WorkflowEvent,
  WorkflowFailureClassifier,
  WorkflowObserver,
} from '../types/events.js';
import { classifyFailureCode } from './failure-classification.js';

type FailureReference =
  | Omit<Extract<WorkflowEvent, { type: 'workflow-failed' }>, 'errorCode'>
  | Omit<Extract<WorkflowEvent, { type: 'step-failed' }>, 'errorCode'>;

export interface WorkflowEventEmitter {
  readonly emit: (event: WorkflowEvent) => void;
  readonly fail: (event: FailureReference, error: unknown) => void;
}

export function createEventEmitter(
  observer: WorkflowObserver | undefined,
  classifyFailure: WorkflowFailureClassifier | undefined
): WorkflowEventEmitter {
  const emit = (event: WorkflowEvent): void => {
    try {
      const result = observer?.(Object.freeze(event));
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Observation has no authority over execution, resource cleanup or terminal results.
    }
  };
  return {
    emit,
    fail(event, error) {
      if (observer === undefined) return;
      const errorCode = classifyFailureCode(classifyFailure, error);
      emit({ ...event, ...(errorCode === undefined ? {} : { errorCode }) });
    },
  };
}
