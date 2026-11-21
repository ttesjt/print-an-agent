import type {
  NavigableCompactableSessionPort,
  SessionExecutionPort,
  SessionLifecyclePort,
  SessionLifecycleQueryPort,
  SessionMemoryNavigationPort,
  SessionMetadataPort,
  SessionPresentationPort,
} from '@print-an-agent/base-session';

export type LocalLifecycleSessionPort = NavigableCompactableSessionPort &
  SessionMetadataPort &
  SessionPresentationPort &
  SessionLifecycleQueryPort &
  SessionLifecyclePort &
  SessionExecutionPort &
  Partial<SessionMemoryNavigationPort>;
