import type { ActorDirectResult } from '@print-an-agent/model-invocation-core';
import type { OutputFailure, OutputStreamEvent } from '../../output/index.js';
/** A per-run channel, without Agent, Session or persistence authority. */
export interface SessionlessOutputSink {
  open(event: Readonly<{ workflowRunId: string }>): Promise<void>;
  readonly write: (event: OutputStreamEvent) => Promise<void>;
  close(result: ActorDirectResult): Promise<void>;
  fail(failure: OutputFailure): Promise<void>;
}

/** Successful channel closure is irreversible, even if a later Run hook fails. */
export type SessionlessOutputOutcome = 'closed' | 'failure-attempted';
