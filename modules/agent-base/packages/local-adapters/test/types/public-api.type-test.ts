import type { SessionMemoryRecord } from '@print-an-agent/base-session';
import type { SessionExecutionRecoveryPort, SessionPurgePort } from '@print-an-agent/base-session';
import type {
  CoordinatedSessionMaintenance,
  CoordinatedSessionPersistence,
  LocalLifecycleSessionPort,
} from '../../src/index.js';
import { MemorySessionAdapter, createMemorySessionPersistence } from '../../src/index.js';

function contract(profile: CoordinatedSessionPersistence): LocalLifecycleSessionPort {
  const maintenance: CoordinatedSessionMaintenance = profile.maintenance;
  // @ts-expect-error Composite maintenance must never substitute for Session-only purge.
  const purge: SessionPurgePort = maintenance;
  // @ts-expect-error Composite maintenance has a distinct recovery scope.
  const recovery: SessionExecutionRecoveryPort = maintenance;
  void purge;
  void recovery;
  return profile.session;
}

void contract(createMemorySessionPersistence({ createSessionId: () => 'fresh' }));

void new MemorySessionAdapter(() => 'legacy-constructor');

// @ts-expect-error Package-private coordination hooks must not become public class members.
void new MemorySessionAdapter().memorySessionCoordination;

// Preserve the raw class result signature; the generic Session Port remains readonly.
type RawPendingRecords = Awaited<ReturnType<MemorySessionAdapter['listPendingMemoryRecords']>>;
const rawPendingRecords = (records: RawPendingRecords): SessionMemoryRecord[] => records;
void rawPendingRecords;
