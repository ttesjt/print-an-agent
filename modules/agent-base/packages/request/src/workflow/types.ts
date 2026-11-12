import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
import type { RequestStepName } from './names.js';
import type { RequestInteractionState } from '../interaction/state.js';

export interface RequestWorkflowStateView {
  readonly interaction?: Pick<RequestInteractionState, 'currentEvent'>;
}
export type RequestWorkflowContext = WorkflowContext<
  RequestStepName,
  unknown,
  RequestWorkflowStateView,
  unknown,
  unknown
>;
export type RequestWorkflowOptions<I, S extends RequestWorkflowStateView, R, O> = Omit<
  WorkflowDefinition<RequestStepName, I, S, R, O | undefined>,
  'name' | 'entryStep' | 'stepDefinitions' | 'createResult'
>;
