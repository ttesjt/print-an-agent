import type {
  CompletionCapability,
  TextTokenInput,
  TokenCounter,
} from '@ta-agent/model-invocation-core';
import {
  createContextMemoryBundle,
  createModelMemoryResources,
  createCompletionMemoryPlanner,
  MemoryMeter,
  type ReadContextResult,
} from '@ta-agent/context-memory';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';

/** A minimal host. The caller owns the Completion and counter; this host owns only its store. */
export async function runProjectMemoryExample(options: {
  path: string;
  completion: CompletionCapability;
  counter: TokenCounter<TextTokenInput>;
}) {
  const store = new SqliteMemoryStore({ path: options.path });
  const failures: unknown[] = [];
  let context: ReadContextResult | undefined;
  try {
    const bundle = createContextMemoryBundle({
      resources: createModelMemoryResources({
        store,
        meter: new MemoryMeter({ counter: options.counter }),
        defaults: { measurementRef: options.counter.descriptor.measurementRef },
        planner: createCompletionMemoryPlanner({ completion: options.completion }),
      }),
    });
    await bundle.workflows.create.run({
      input: { memoryId: 'example:project', requestId: 'example:create' },
    });
    await bundle.workflows.observe.run({
      input: {
        memoryId: 'example:project',
        requestId: 'example:observe',
        context: [
          { role: 'user', content: 'Prefer concise answers.', source: { kind: 'example' } },
        ],
      },
    });
    context = await bundle.workflows.readContext.run({ input: { memoryId: 'example:project' } });
  } catch (cause) {
    failures.push(cause);
  }
  // All started operations have settled, including cooperative cancellation/drain.
  try {
    store.close();
  } catch (cleanup) {
    failures.push(cleanup);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Operation and cleanup failed.', { cause: failures[0] });
  return context;
}
