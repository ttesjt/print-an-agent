import {
  BUILT_IN_RESPONSIBILITIES,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
} from '@ta-agent/base-actor';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';
import {
  createVersionedContextMemoryBundle,
  createVersionedContextMemoryResources,
  MemoryMeter,
  type VersionedMemoryWorkflowDefinitions,
} from '@ta-agent/context-memory';
import { MemorySessionAdapter, type SqliteSessionAdapter } from '@ta-agent/base-local-adapters';
import { CONTEXT_MEMORY_TOOL_NAMES, createSessionContextMemory } from '../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from './compaction-token-counter.js';

export function runtimeMemoryFixture(
  writable = false,
  workflows?: Partial<VersionedMemoryWorkflowDefinitions>,
  suppliedSession?: MemorySessionAdapter | SqliteSessionAdapter
) {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = createVersionedContextMemoryBundle({
    resources: createVersionedContextMemoryResources({
      store,
      meter: new MemoryMeter({ counter: TEST_COMPACTION_TOKEN_COUNTER }),
      defaults: { measurementRef: TEST_COMPACTION_TOKEN_COUNTER.descriptor.measurementRef },
    }),
    ...(workflows === undefined ? {} : { workflows }),
  });
  const session = suppliedSession ?? new MemorySessionAdapter();
  const service = createSessionContextMemory({
    writable,
    authorityId: 'test-authority',
    session,
    memory: memory.workflows,
    createMemoryId: () => `doc:${crypto.randomUUID()}`,
  });
  return { store, memory, session, service };
}
export function memoryToolPermissions() {
  return {
    mainActor: { allowedTools: CONTEXT_MEMORY_TOOL_NAMES },
    responsibilities: BUILT_IN_RESPONSIBILITIES.map((r) =>
      r.id === FOREGROUND_INTERACTION_RESPONSIBILITY_ID
        ? { ...r, allowedTools: CONTEXT_MEMORY_TOOL_NAMES }
        : r
    ),
    productToolAllowList: CONTEXT_MEMORY_TOOL_NAMES,
    runtimeToolAllowList: CONTEXT_MEMORY_TOOL_NAMES,
  };
}
