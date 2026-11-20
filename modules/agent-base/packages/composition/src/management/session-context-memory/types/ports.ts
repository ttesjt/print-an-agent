import type {
  InspectableSessionPort,
  SessionExecutionPort,
  SessionMemoryNavigationPort,
} from '@print-an-agent/base-session';

export type RuntimeMemorySessionPort = Pick<InspectableSessionPort, 'inspect'> &
  SessionMemoryNavigationPort &
  SessionExecutionPort;
