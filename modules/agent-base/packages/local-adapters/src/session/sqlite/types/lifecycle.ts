import type {
  SessionExecutionFence,
  SessionExecutionId,
  SessionLifecycleSnapshot,
} from '@print-an-agent/base-session';

export interface SqliteSessionLifecycleState {
  readonly snapshot: SessionLifecycleSnapshot;
  readonly fence: SessionExecutionFence;
  readonly ids: readonly SessionExecutionId[];
}
