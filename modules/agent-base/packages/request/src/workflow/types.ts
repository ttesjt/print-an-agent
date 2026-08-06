import type {
  AnyAgentContext,
  BaseWorkflowContext,
  WorkflowDefinition,
} from '@ta-agent/base-workflow';
import type { RequestStepName } from './names.js';

export type RequestWorkflowContext<
  C extends AnyAgentContext = AnyAgentContext,
  TResult = unknown,
> = BaseWorkflowContext<RequestStepName, C, TResult>;

export type RequestWorkflowOptions<
  C extends AnyAgentContext,
  WC extends RequestWorkflowContext<C, TResult>,
  TResult,
> = Omit<
  WorkflowDefinition<RequestStepName, C, WC, TResult>,
  'name' | 'entryStep' | 'stepDefinitions'
>;
