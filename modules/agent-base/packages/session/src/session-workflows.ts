import type { StepDefinitions, StepOverrides } from '@print-an-agent/workflow-core';
import {
  createDefaultSessionCompactionStepOverrides as compactionDefaults,
  createSessionCompactionStepDefinitions as compactionDefinitions,
  createSessionCompactionWorkflow,
  createShouldCompactSessionCondition as compactionCondition,
  type SessionCompactionResources as CompactionResources,
  type SessionCompactionStepName,
} from './compaction/index.js';
import {
  createDefaultSessionNavigationStepOverrides as navigationDefaults,
  createSessionNavigationStepDefinitions as navigationDefinitions,
  createSessionNavigationWorkflow,
  type SessionNavigationResources as NavigationResources,
  type SessionNavigationStepName,
} from './navigation/index.js';
import type {
  SessionCompactionCondition,
  SessionCompactionResources,
  SessionCompactionWorkflowContext,
  SessionNavigationResources,
  SessionNavigationWorkflowContext,
} from './types/session-workflows.js';

export { createSessionCompactionWorkflow, createSessionNavigationWorkflow };

/**
 * Feature implementations require narrow ports; package helpers retain full Session defaults.
 * Keep the legacy overload last so ReturnType also preserves existing override declarations.
 */
export function createDefaultSessionCompactionStepOverrides<
  R extends CompactionResources = SessionCompactionResources,
>(): StepOverrides<SessionCompactionStepName, SessionCompactionWorkflowContext<R>>;
export function createDefaultSessionCompactionStepOverrides(): StepOverrides<
  SessionCompactionStepName,
  SessionCompactionWorkflowContext
>;
export function createDefaultSessionCompactionStepOverrides<
  R extends CompactionResources = SessionCompactionResources,
>(): StepOverrides<SessionCompactionStepName, SessionCompactionWorkflowContext<R>> {
  return compactionDefaults();
}

export function createSessionCompactionStepDefinitions<
  R extends CompactionResources = SessionCompactionResources,
>(): StepDefinitions<SessionCompactionStepName, SessionCompactionWorkflowContext<R>>;
export function createSessionCompactionStepDefinitions(): StepDefinitions<
  SessionCompactionStepName,
  SessionCompactionWorkflowContext
>;
export function createSessionCompactionStepDefinitions<
  R extends CompactionResources = SessionCompactionResources,
>(): StepDefinitions<SessionCompactionStepName, SessionCompactionWorkflowContext<R>> {
  return compactionDefinitions();
}

export function createShouldCompactSessionCondition<
  R extends CompactionResources = SessionCompactionResources,
>(): SessionCompactionCondition<R>;
export function createShouldCompactSessionCondition(): SessionCompactionCondition;
export function createShouldCompactSessionCondition<
  R extends CompactionResources = SessionCompactionResources,
>(): SessionCompactionCondition<R> {
  return compactionCondition();
}

export function createDefaultSessionNavigationStepOverrides<
  R extends NavigationResources = SessionNavigationResources,
>(): StepOverrides<SessionNavigationStepName, SessionNavigationWorkflowContext<R>>;
export function createDefaultSessionNavigationStepOverrides(): StepOverrides<
  SessionNavigationStepName,
  SessionNavigationWorkflowContext
>;
export function createDefaultSessionNavigationStepOverrides<
  R extends NavigationResources = SessionNavigationResources,
>(): StepOverrides<SessionNavigationStepName, SessionNavigationWorkflowContext<R>> {
  return navigationDefaults();
}

export function createSessionNavigationStepDefinitions<
  R extends NavigationResources = SessionNavigationResources,
>(): StepDefinitions<SessionNavigationStepName, SessionNavigationWorkflowContext<R>>;
export function createSessionNavigationStepDefinitions(): StepDefinitions<
  SessionNavigationStepName,
  SessionNavigationWorkflowContext
>;
export function createSessionNavigationStepDefinitions<
  R extends NavigationResources = SessionNavigationResources,
>(): StepDefinitions<SessionNavigationStepName, SessionNavigationWorkflowContext<R>> {
  return navigationDefinitions();
}
