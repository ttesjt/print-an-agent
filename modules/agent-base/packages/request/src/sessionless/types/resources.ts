import type { ResolvedActor } from '@print-an-agent/model-invocation-core';
import type { SessionlessRequestInput, SessionlessValidatedRequest } from './input.js';
import type { SessionlessOutputSink } from './output.js';
import type { SessionlessPolicy } from './policy.js';
export interface SessionlessGenerationResources {
  readonly actor: ResolvedActor;
  readonly policy?: Partial<SessionlessPolicy>;
  readonly instructionContributors?: readonly ((context: {
    readonly request: SessionlessValidatedRequest;
  }) => string | Promise<string>)[];
  readonly createOutputSink?: (
    context: Readonly<{
      request: SessionlessRequestInput;
      workflowRunId: string;
      signal: AbortSignal;
    }>
  ) => SessionlessOutputSink | Promise<SessionlessOutputSink>;
  readonly clock?: () => number;
}

export interface BoundSessionlessGenerationResources extends Omit<
  SessionlessGenerationResources,
  'policy' | 'instructionContributors' | 'clock'
> {
  readonly policy: SessionlessPolicy;
  readonly instructionContributors: NonNullable<
    SessionlessGenerationResources['instructionContributors']
  >;
  readonly clock: () => number;
}

/** Internal neutral names reuse the same public contracts; no duplicate resource model. */
export type SessionlessResources = SessionlessGenerationResources;
export type BoundSessionlessResources = BoundSessionlessGenerationResources;
