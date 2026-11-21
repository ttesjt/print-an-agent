import { describe, expect, it, vi } from 'vitest';
import { InteractionEventDelivery } from '../../../src/interaction/event-delivery.js';

describe('Interaction event delivery', () => {
  it('serializes accepted events and preserves current-event lifetime and backpressure', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const observed: string[] = [];
    const delivery = new InteractionEventDelivery({
      signal: new AbortController().signal,
      capacity: 2,
      dispatch: async (event) => {
        expect(delivery.currentEvent).toBe(event);
        if (event.type !== 'text-delta') throw new Error('Expected text.');
        observed.push(event.delta);
        if (event.delta === 'first') {
          started.resolve();
          await release.promise;
        }
        expect(delivery.currentEvent).toBe(event);
      },
    });
    let firstFinished = false;
    const first = delivery.emit({ type: 'text-delta', delta: 'first' }).then(() => {
      firstFinished = true;
    });
    const second = delivery.emit({ type: 'text-delta', delta: 'second' });
    await started.promise;
    expect(firstFinished).toBe(false);
    expect(observed).toEqual(['first']);
    const finish = delivery.finish();
    await expect(delivery.emit({ type: 'turn-start' })).rejects.toMatchObject({
      code: 'REQUEST_INTERACTION_EVENT_DELIVERY_CLOSED',
    });
    release.resolve();
    await Promise.all([first, second, finish]);
    expect(observed).toEqual(['first', 'second']);
    expect(delivery.currentEvent).toBeUndefined();
    delivery.dispose();
  });

  it('counts active delivery toward capacity and locks overflow even when the caller catches it', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const observed: string[] = [];
    const delivery = new InteractionEventDelivery({
      signal: new AbortController().signal,
      capacity: 2,
      dispatch: async (event) => {
        observed.push(event.type);
        started.resolve();
        await release.promise;
      },
    });
    const first = delivery.emit({ type: 'turn-start' });
    await started.promise;
    const queued = delivery.emit({ type: 'turn-end' });
    const error = await delivery.emit({ type: 'interaction-end' }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'REQUEST_INTERACTION_EVENT_QUEUE_FULL' });
    expect(delivery.signal.aborted).toBe(true);
    release.resolve();
    await expect(first).rejects.toBe(error);
    await expect(queued).rejects.toBe(error);
    await expect(delivery.finish()).rejects.toBe(error);
    expect(observed).toEqual(['turn-start']);
    expect(delivery.currentEvent).toBeUndefined();
    delivery.dispose();
  });

  it('retains the first dispatch failure and does not execute pending events', async () => {
    const failure = new Error('sink failed');
    const dispatch = vi.fn(() => Promise.reject(failure));
    const delivery = new InteractionEventDelivery({
      signal: new AbortController().signal,
      capacity: 3,
      dispatch,
    });
    // Intentionally do not consume these Promises: the delivery owner must observe their failures.
    void delivery.emit({ type: 'turn-start' });
    void delivery.emit({ type: 'turn-end' });
    await expect(delivery.finish()).rejects.toBe(failure);
    expect(delivery.stop(new Error('secondary failure'))).toBe(failure);
    await expect(delivery.emit({ type: 'interaction-end' })).rejects.toBe(failure);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(delivery.currentEvent).toBeUndefined();
    delivery.dispose();
  });

  it('stops queued events on cancellation but drains an in-flight write before cleanup', async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    const delivery = new InteractionEventDelivery({
      signal: controller.signal,
      capacity: 2,
      dispatch: async () => {
        calls++;
        started.resolve();
        await release.promise;
      },
    });
    const first = delivery.emit({ type: 'turn-start' });
    const second = delivery.emit({ type: 'turn-end' });
    await started.promise;
    controller.abort();
    let drained = false;
    const draining = delivery.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release.resolve();
    await draining;
    for (const promise of [first, second, delivery.finish()]) {
      await expect(promise).rejects.toMatchObject({ code: 'MODEL_INVOCATION_CANCELLED' });
    }
    expect(calls).toBe(1);
    delivery.dispose();
  });

  it('does not accept work from an already-cancelled signal and removes its listener', async () => {
    const controller = new AbortController();
    controller.abort();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const dispatch = vi.fn(() => Promise.resolve());
    const delivery = new InteractionEventDelivery({
      signal: controller.signal,
      capacity: 1,
      dispatch,
    });
    await expect(delivery.emit({ type: 'turn-start' })).rejects.toMatchObject({
      code: 'MODEL_INVOCATION_CANCELLED',
    });
    delivery.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Infinity])('rejects invalid capacity %s', (capacity) => {
    expect(
      () =>
        new InteractionEventDelivery({
          signal: new AbortController().signal,
          capacity,
          dispatch: () => Promise.resolve(),
        })
    ).toThrowError('Interaction event capacity must be a positive safe integer.');
  });

  it('preserves a timeout abort reason for the Engine while reporting the stable timeout failure', async () => {
    const controller = new AbortController();
    const reason = new DOMException('deadline', 'TimeoutError');
    const delivery = new InteractionEventDelivery({
      signal: controller.signal,
      capacity: 1,
      dispatch: () => Promise.resolve(),
    });
    controller.abort(reason);
    expect(delivery.signal.reason).toBe(reason);
    await expect(delivery.finish()).rejects.toMatchObject({ code: 'MODEL_INVOCATION_TIMEOUT' });
    delivery.dispose();
  });
});
