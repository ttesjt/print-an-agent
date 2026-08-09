import type {
  AnyAgentRunContext,
  BaseWorkflowContext,
  WorkflowDefinition,
} from '@ta-agent/base-workflow';
import type { RequestStepName } from './names.js';

export type RequestWorkflowContext<
  C extends AnyAgentRunContext = AnyAgentRunContext,
  TResult = unknown,
> = BaseWorkflowContext<RequestStepName, C, TResult>;

export type RequestWorkflowOptions<
  C extends AnyAgentRunContext,
  WC extends RequestWorkflowContext<C, TResult>,
  TResult,
> = Omit<
  WorkflowDefinition<RequestStepName, C, WC, TResult>,
  'name' | 'entryStep' | 'stepDefinitions'
>;
