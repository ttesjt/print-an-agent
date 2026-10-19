import { expect, it } from 'vitest';
import {
  createMemoryObserveDefinition,
  createMemoryEditDefinition,
  createMemoryCompactDefinition,
  modelMemorySignal,
  type ModelMemoryContext,
  type ModelMemoryDefinition,
} from '@ta-agent/context-memory';
import type { Step } from '@ta-agent/workflow-core';
import { consumer } from './support/model.js';
import { memoryPath, ownedStore } from './support/storage.js';

it('shares customized compaction instructions and a named Step across all three model entries', async () => {
  const base = createMemoryCompactDefinition().stepDefinitions.planCompaction.step;
  if (base === undefined) throw new Error('Missing public default planning Step.');
  const visited: string[] = [];
  const sharedPlan: Step<ModelMemoryContext> = async (context) => {
    visited.push(context.workflowName);
    modelMemorySignal(context).throwIfAborted();
    await base(context);
  };
  const common = { stepOverrides: { planCompaction: sharedPlan } };
  const client = consumer(
    ownedStore(await memoryPath()),
    (request) => {
      const first = request.items[0];
      if (request.task !== 'compact') return [{ op: 'add', content: 'x'.repeat(20) }];
      if (first === undefined) throw new Error('Expected items.');
      return [
        { op: 'replace', itemId: first.id, content: 'short' },
        ...request.items.slice(1).map((item) => ({ op: 'remove' as const, itemId: item.id })),
      ];
    },
    {
      resources: {
        defaults: { measurementRef: 'qualification:codepoints:v1', maxContextTokens: 10 },
      },
      instructions: { compact: 'Use the consumer-specific compaction policy.' },
      workflows: {
        observe: createMemoryObserveDefinition(common),
        edit: createMemoryEditDefinition(common),
        compact: createMemoryCompactDefinition(common),
      },
    }
  );
  for (const memoryId of ['observe', 'edit', 'compact'])
    await client.bundle.workflows.create.run({
      input: { memoryId, requestId: 'create', items: [{ content: 'original' }] },
    });
  await client.bundle.workflows.observe.run({
    input: { memoryId: 'observe', requestId: 'go', context: [] },
  });
  await client.bundle.workflows.edit.run({
    input: { memoryId: 'edit', requestId: 'go', instruction: 'edit' },
  });
  await client.bundle.workflows.compact.run({
    input: { memoryId: 'compact', requestId: 'go', target: { maxTokens: 5 } },
  });
  expect(visited).toEqual([
    'context-memory.observe',
    'context-memory.edit',
    'context-memory.compact',
  ]);
  const compactInstructions = client.actor.instructions.filter((text) =>
    text.includes('consumer-specific')
  );
  expect(compactInstructions).toHaveLength(3);
});

/** A different native graph: one plan and commit, no default assessment or retry composite. */
function onePassCompact(): ModelMemoryDefinition {
  const base = createMemoryCompactDefinition();
  return {
    ...base,
    stepDefinitions: {
      ...base.stepDefinitions,
      runModelOperation: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          await context.runStep('prepareInput');
          await context.runStep('beginUpdate');
          if (context.result.status !== 'skipped') return;
          const target = context.state.update?.targetTokens;
          if (target !== undefined) context.state.plannerTargetTokens = target;
          await context.runStep('planCompaction');
          await context.runStep('applyCompaction');
          await context.runStep('commitCandidate');
        },
      },
    },
  };
}
it('replaces a complete compact graph but still cannot skip the private final budget', async () => {
  const client = consumer(
    ownedStore(await memoryPath()),
    (request) => {
      const first = request.items[0];
      if (first === undefined) throw new Error('Missing item.');
      return [{ op: 'replace', itemId: first.id, content: 'short' }];
    },
    { workflows: { compact: onePassCompact() } }
  );
  await client.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'original' }] },
  });
  await expect(
    client.bundle.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'too-small', target: { maxTokens: 2 } },
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  expect(
    (await client.bundle.workflows.readContext.run({ input: { memoryId: 'a' } }))?.snapshot.revision
  ).toBe(1);
  expect(
    await client.bundle.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'fits', target: { maxTokens: 5 } },
    })
  ).toMatchObject({ status: 'committed', receipt: { revision: 2 } });
  expect(client.actor.requests).toHaveLength(2);
});
