import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiProviderTransportLivenessBoundary } from '../../src/runtime/pi-provider-transport-liveness.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Pi provider transport liveness boundary', () => {
  it('forwards the parent signal unchanged when both deadlines are disabled', () => {
    const parent = new AbortController();
    const boundary = createPiProviderTransportLivenessBoundary({
      parentSignal: parent.signal,
      policy: {
        responseStartTimeoutMilliseconds: null,
        streamEventIdleTimeoutMilliseconds: null,
      },
      onTimeout: vi.fn(),
    });

    expect(boundary.signal).toBe(parent.signal);
  });

  it('owns and identifies a response-start deadline without aborting its parent', () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const onTimeout = vi.fn();
    const boundary = createPiProviderTransportLivenessBoundary({
      parentSignal: parent.signal,
      policy: {
        responseStartTimeoutMilliseconds: 25,
        streamEventIdleTimeoutMilliseconds: null,
      },
      onTimeout,
    });

    vi.advanceTimersByTime(25);

    expect(onTimeout).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MODEL_PROVIDER_RESPONSE_START_TIMEOUT' })
    );
    expect(boundary.signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
  });

  it('resets the stream-event idle deadline on each normalized provider event', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const boundary = createPiProviderTransportLivenessBoundary({
      parentSignal: new AbortController().signal,
      policy: {
        responseStartTimeoutMilliseconds: 100,
        streamEventIdleTimeoutMilliseconds: 30,
      },
      onTimeout,
    });

    vi.advanceTimersByTime(20);
    boundary.responseStarted();
    vi.advanceTimersByTime(20);
    boundary.streamEventReceived();
    vi.advanceTimersByTime(100);
    expect(onTimeout).not.toHaveBeenCalled();
    boundary.waitForNextStreamEvent();
    vi.advanceTimersByTime(29);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onTimeout).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MODEL_PROVIDER_STREAM_IDLE_TIMEOUT' })
    );
  });

  it('cleans local timers when the parent cancels or the boundary closes', () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const parentTimeout = vi.fn();
    const cancelled = createPiProviderTransportLivenessBoundary({
      parentSignal: parent.signal,
      policy: {
        responseStartTimeoutMilliseconds: 25,
        streamEventIdleTimeoutMilliseconds: 25,
      },
      onTimeout: parentTimeout,
    });
    parent.abort(new Error('caller cancellation'));

    const closedTimeout = vi.fn();
    const closed = createPiProviderTransportLivenessBoundary({
      parentSignal: new AbortController().signal,
      policy: {
        responseStartTimeoutMilliseconds: 25,
        streamEventIdleTimeoutMilliseconds: 25,
      },
      onTimeout: closedTimeout,
    });
    closed.close();
    vi.advanceTimersByTime(100);

    expect(cancelled.signal.reason).toBe(parent.signal.reason);
    expect(parentTimeout).not.toHaveBeenCalled();
    expect(closedTimeout).not.toHaveBeenCalled();
  });
});
