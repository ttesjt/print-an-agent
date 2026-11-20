import type {
  CreateSessionCompactionWorkflowOptions as CompactionOptions,
  SessionCompactionCondition as CompactionCondition,
  SessionCompactionDefinition as CompactionDefinition,
  SessionCompactionResources as CompactionResources,
  SessionCompactionWorkflowContext as CompactionContext,
} from '../compaction/index.js';
import type {
  CreateSessionNavigationWorkflowOptions as NavigationOptions,
  SessionNavigationResources as NavigationResources,
  SessionNavigationWorkflowContext as NavigationContext,
} from '../navigation/index.js';
import type { CompactableSessionPort, NavigableSessionPort } from './session-ports.js';

/** Preserve the package API's full Session defaults without coupling features to this aggregate. */
export interface SessionCompactionResources<
  S extends CompactionResources['session'] = CompactableSessionPort,
> extends CompactionResources {
  readonly session: S;
}

export type SessionCompactionWorkflowContext<
  R extends CompactionResources = SessionCompactionResources,
> = CompactionContext<R>;

export type SessionCompactionDefinition<
  R extends CompactionResources = SessionCompactionResources,
> = CompactionDefinition<R>;

export type SessionCompactionCondition<R extends CompactionResources = SessionCompactionResources> =
  CompactionCondition<R>;

export type CreateSessionCompactionWorkflowOptions<
  R extends CompactionResources = SessionCompactionResources,
> = CompactionOptions<R>;

export interface SessionNavigationResources<
  S extends NavigationResources['session'] = NavigableSessionPort,
> extends NavigationResources {
  readonly session: S;
}

export type SessionNavigationWorkflowContext<
  R extends NavigationResources = SessionNavigationResources,
> = NavigationContext<R>;

export type CreateSessionNavigationWorkflowOptions<
  R extends NavigationResources = SessionNavigationResources,
> = NavigationOptions<R>;
