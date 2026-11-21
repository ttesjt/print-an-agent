import {
  BUILT_IN_RESPONSIBILITIES,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
} from '@print-an-agent/agent-actor';
import {
  MemorySessionAdapter,
  type SqliteSessionAdapter,
} from '@print-an-agent/base-local-adapters';
import {
  createVersionedContextMemoryBundle,
  createVersionedContextMemoryResources,
  MemoryMeter,
  type VersionedMemoryWorkflowDefinitions,
} from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { CONTEXT_MEMORY_TOOL_NAMES, createSessionContextMemory } from '../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../runtime/compaction-token-counter.js';

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
