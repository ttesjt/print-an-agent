import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
import type { RequestInteractionState } from '../interaction/index.js';
import type { RequestStepName } from './names.js';

export interface RequestWorkflowStateView<O = unknown> {
  readonly interaction?: Pick<RequestInteractionState, 'currentEvent'>;
  /** Response finalized for delivery or replay. Also ends request preparation early. */
  completedResponse?: O;
}
export type RequestWorkflowContext = WorkflowContext<
  RequestStepName,
  RequestWorkflowStateView,
  unknown
>;
export type RequestWorkflowOptions<I, S extends RequestWorkflowStateView<O>, R, O> = Omit<
  WorkflowDefinition<RequestStepName, I, S, R, O | undefined>,
  'name' | 'entryStep' | 'stepDefinitions' | 'createResult' | 'createSkippedResult'
>;
