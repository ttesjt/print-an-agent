import type { AgentLoopEventSink } from '@ta-agent/base-model';
import { describe, expect, it, vi } from 'vitest';
import { interactionAgent, interactionMessage } from '../support/interaction-agent.js';

describe('interaction failure lifecycle', () => {
  it.each(['reject', 'return'] as const)(
    'retains cooperative cancellation or rejects success when the Engine chooses to %s',
    async (mode) => {
      const controller = new AbortController();
      const reason = new DOMException('cancelled', 'AbortError');
      const fixture = await interactionAgent(async (request) => {
        controller.abort(reason);
        expect(request.signal.reason).toBe(reason);
        if (mode === 'reject') throw reason;
        const message = interactionMessage();
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      });
      const commit = vi.spyOn(fixture.session, 'completeTurn');
      const run = fixture.run(controller.signal);
      if (mode === 'reject') await expect(run).rejects.toBe(reason);
      else await expect(run).rejects.toMatchObject({ code: 'MODEL_INVOCATION_CANCELLED' });
      expect(commit).not.toHaveBeenCalled();
      expect(fixture.output.inspect()).toMatchObject({ status: 'failed' });
    }
  );

  it('drains active delivery and discards queued work before failure cleanup when Engine rejects', async () => {
    const started = Promise.withResolvers<void>();
    const stopped = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failure = new Error('Engine failed');
    const calls: string[] = [];
    let lateEmit: AgentLoopEventSink | undefined;
    const fixture = await interactionAgent(async (request) => {
      lateEmit = request.emit;
      request.signal.addEventListener('abort', () => stopped.resolve(), { once: true });
      void request.emit({ type: 'text-delta', delta: 'first' });
      await started.promise;
      void request.emit({ type: 'text-delta', delta: 'queued' });
      throw failure;
    });
    const write = fixture.output.write.bind(fixture.output);
    const fail = fixture.output.fail.bind(fixture.output);
    vi.spyOn(fixture.output, 'write').mockImplementation(async (event) => {
      calls.push(event.delta);
      started.resolve();
      await release.promise;
      await write(event);
      calls.push('write-finished');
    });
    vi.spyOn(fixture.output, 'fail').mockImplementation(async (error) => {
      calls.push('fail');
      await fail(error);
    });
    const commit = vi.spyOn(fixture.session, 'completeTurn');
    const checked = expect(fixture.run()).rejects.toBe(failure);
    await stopped.promise;
    expect(calls).toEqual(['first']);
    release.resolve();
    await checked;
    expect(calls).toEqual(['first', 'write-finished', 'fail']);
    expect(commit).not.toHaveBeenCalled();
    if (lateEmit === undefined) throw new Error('Expected Engine callback.');
    await expect(lateEmit({ type: 'text-delta', delta: 'late' })).rejects.toBe(failure);
    expect(calls).toEqual(['first', 'write-finished', 'fail']);
  });
});
