import { expect, it, vi } from 'vitest';
import { bindAgentWorkflow } from '../../src/index.js';
import { context, workflow, type Run } from '../support/workflow-binding.js';

it('drains a cancelled parallel child before parent resources and Agent result application', async () => {
  const started = Promise.withResolvers<void>();
  const exiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const order: string[] = [];
  const applyResult = vi.fn();
  const failure = new Error('child failed');
  const parent = new AbortController();
  const binding = bindAgentWorkflow({
    projectInput: (context: Run) => context,
    applyResult,
    workflow: workflow({
      stepOverrides: {
        entry: async (ctx) => {
          try {
            await ctx.parallel(['child', 'peer']);
          } finally {
            order.push('parent-close');
          }
        },
        child: async () => {
          await started.promise;
          throw failure;
        },
        peer: async (ctx) => {
          started.resolve();
          await new Promise<void>((resolve) =>
            ctx.signal.addEventListener('abort', () => resolve(), { once: true })
          );
          exiting.resolve();
          await release.promise;
          order.push('peer-close');
        },
      },
      lifecycle: {
        onFinally: () => {
          order.push('workflow-close');
        },
      },
    }),
  });
  const result = binding.run(context(parent.signal));
  const checked = expect(result).rejects.toBe(failure);
  await exiting.promise;
  expect(order).toEqual([]);
  expect(parent.signal.aborted).toBe(false);
  release.resolve();
  await checked;
  expect(order).toEqual(['peer-close', 'parent-close', 'workflow-close']);
  expect(applyResult).not.toHaveBeenCalled();
});

it('uses Core admission cancellation without starting new Step side effects', async () => {
  const source = new AbortController();
  const reason = new Error('cancel before admission');
  source.abort(reason);
  const child = vi.fn(() => Promise.resolve());
  const binding = bindAgentWorkflow({
    projectInput: (context: Run) => context,
    applyResult: () => undefined,
    workflow: workflow({ stepOverrides: { child } }),
  });
  await expect(binding.run(context(source.signal))).rejects.toBe(reason);
  expect(child).not.toHaveBeenCalled();
});
