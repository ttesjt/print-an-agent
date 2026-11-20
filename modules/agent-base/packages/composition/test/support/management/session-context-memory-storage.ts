import { SqliteSessionAdapter } from '@print-an-agent/base-local-adapters';
import type { VersionedMemoryWorkflowDefinitions } from '@print-an-agent/context-memory';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import { runtimeMemoryFixture } from './runtime-context-memory.js';

export async function storedRuntimeMemoryFixture(
  storage: 'memory' | 'sqlite',
  workflows?: Partial<VersionedMemoryWorkflowDefinitions>
) {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-memory-coordination-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const f = runtimeMemoryFixture(
    true,
    workflows,
    storage === 'sqlite'
      ? new SqliteSessionAdapter({ databasePath: join(directory, 'sessions.sqlite') })
      : undefined
  );
  onTestFinished(() => f.store.close());
  return f;
}
