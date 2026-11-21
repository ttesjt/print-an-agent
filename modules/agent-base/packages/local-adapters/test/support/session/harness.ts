import {
  type NavigableCompactableSessionPort,
  type SessionMetadataPort,
  type SessionQueryPort,
} from '@print-an-agent/base-session';
import type { SessionPortContractHarness } from './types.js';

export async function withHarness<T>(
  createHarness: () => SessionPortContractHarness,
  action: (
    adapter: NavigableCompactableSessionPort & SessionQueryPort & SessionMetadataPort
  ) => Promise<T>
): Promise<T> {
  const harness = createHarness();
  try {
    return await action(harness.adapter);
  } finally {
    harness.dispose?.();
  }
}
