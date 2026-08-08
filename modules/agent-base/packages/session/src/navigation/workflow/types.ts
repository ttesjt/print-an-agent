import type { AgentIdentity } from '@ta-agent/base-identity';
import type {
  BaseAgentContext,
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
import type { SessionNavigationStepName } from './names.js';

export interface SessionNavigationResources {
  readonly session: NavigableSessionPort;
}

export interface SessionNavigationAgentContext extends BaseAgentContext<
  NavigateSessionInput,
  SessionNavigationOutcome
> {
  readonly identity: AgentIdentity;
  readonly resources: SessionNavigationResources;
}

export interface SessionNavigationWorkflowContext extends BaseWorkflowContext<
  SessionNavigationStepName,
  SessionNavigationAgentContext,
  SessionNavigationOutcome
> {
  readonly resources: SessionNavigationResources;
  sessionId?: SessionId;
  command?: ValidatedSessionNavigationCommand;
  snapshot?: SessionSnapshot;
}

export interface CreateSessionNavigationWorkflowOptions extends Omit<
  WorkflowDefinition<
    SessionNavigationStepName,
    SessionNavigationAgentContext,
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
