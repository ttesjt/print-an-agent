import type { AgentIdentity } from '@ta-agent/base-identity';
import type {
  BaseAgentRunContext,
  BaseWorkflowContext,
  StepOverrides,
  WorkflowDefinition,
} from '@ta-agent/base-workflow';
import type {
  NavigateSessionInput,
  NavigableSessionPort,
  SessionNavigationOutcome,
  ValidatedSessionNavigationCommand,
} from '../contracts.js';
import type { SessionId, SessionSnapshot } from '../../types.js';
import type { SessionExecutionLease } from '../../lifecycle/execution.js';
import type { SessionNavigationStepName } from './names.js';

export interface SessionNavigationResources {
  readonly session: NavigableSessionPort;
}

export interface SessionNavigationAgentRunContext extends BaseAgentRunContext<
  NavigateSessionInput,
  SessionNavigationOutcome
> {
  readonly identity: AgentIdentity;
  readonly resources: SessionNavigationResources;
}

export interface SessionNavigationWorkflowContext extends BaseWorkflowContext<
  SessionNavigationStepName,
  SessionNavigationAgentRunContext,
  SessionNavigationOutcome
> {
  readonly resources: SessionNavigationResources;
  sessionId?: SessionId;
  execution?: SessionExecutionLease;
  command?: ValidatedSessionNavigationCommand;
  snapshot?: SessionSnapshot;
}

export interface CreateSessionNavigationWorkflowOptions extends Omit<
  WorkflowDefinition<
    SessionNavigationStepName,
    SessionNavigationAgentRunContext,
    SessionNavigationWorkflowContext,
    SessionNavigationOutcome
  >,
  'name' | 'entryStep' | 'stepDefinitions' | 'createContext' | 'applyResult'
> {
  readonly resources: SessionNavigationResources;
  readonly stepOverrides?: StepOverrides<
    SessionNavigationStepName,
    SessionNavigationWorkflowContext
  >;
}
