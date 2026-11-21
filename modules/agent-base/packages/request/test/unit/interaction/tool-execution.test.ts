import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { InteractionToolExecution } from '../../../src/interaction/tool-execution.js';

it('rejects ingress during final drainage without replacing the pending execution tail', async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  const order: string[] = [];
  const execution = new InteractionToolExecution(
    {
      tools: [],
      execute: async (_proposal, options) => {
        if (options?.signal === undefined) throw new Error('Expected effective signal.');
        started.resolve(options.signal);
        await release.promise;
        order.push('handler-settled');
        return { status: 'success', text: 'done' };
      },
    },
    new AbortController().signal,
    (cause) => cause
  );
  const accepted = execution.port.execute({ callId: 'accepted', toolName: 'work', arguments: {} });
  const signal = await started.promise;
  const finish = execution.finish().finally(() => order.push('finished'));
  const checked = expect(finish).rejects.toMatchObject({ code: 'TOOL_RUN_CLOSED' });
  try {
    await expect(
      execution.port.execute({ callId: 'late', toolName: 'work', arguments: {} })
    ).rejects.toMatchObject({ code: 'TOOL_RUN_CLOSED' });
    expect(signal.aborted).toBe(true);
    await setImmediate();
    expect(order).toEqual([]);
    release.resolve();
    await accepted;
    await checked;
    expect(order).toEqual(['handler-settled', 'finished']);
  } finally {
    release.resolve();
    await accepted;
    await checked;
  }
});
