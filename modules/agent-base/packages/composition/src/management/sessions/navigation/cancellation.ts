import { AgentSessionError } from '@print-an-agent/base-session';

export function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new AgentSessionError(
    'SESSION_NAVIGATION_CANCELLED',
    'Session navigation was cancelled before its commit boundary.',
    signal.reason === undefined ? undefined : { cause: signal.reason }
  );
}
