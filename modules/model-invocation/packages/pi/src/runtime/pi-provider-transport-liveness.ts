import {
  ModelInvocationError,
  type ProviderTransportLivenessPolicy,
  type ProviderTransportTimeoutMilliseconds,
} from '@ta-agent/model-invocation-core';

interface CreatePiProviderTransportLivenessBoundaryOptions {
  readonly parentSignal: AbortSignal;
  readonly policy: ProviderTransportLivenessPolicy;
  readonly onTimeout: (failure: ModelInvocationError) => void;
}

export interface PiProviderTransportLivenessBoundary {
  readonly signal: AbortSignal;
  responseStarted(): void;
  streamEventReceived(): void;
  waitForNextStreamEvent(): void;
  close(): void;
}

export function createPiProviderTransportLivenessBoundary(
  options: CreatePiProviderTransportLivenessBoundaryOptions
): PiProviderTransportLivenessBoundary {
  const responseStartTimeout = options.policy.responseStartTimeoutMilliseconds;
  const streamIdleTimeout = options.policy.streamEventIdleTimeoutMilliseconds;
  if (responseStartTimeout === null && streamIdleTimeout === null) {
    return Object.freeze({
      signal: options.parentSignal,
      responseStarted: () => undefined,
      streamEventReceived: () => undefined,
      waitForNextStreamEvent: () => undefined,
      close: () => undefined,
    });
  }

  const timeoutController = new AbortController();
  const signal = AbortSignal.any([options.parentSignal, timeoutController.signal]);
  let phase: 'awaiting-response' | 'streaming' | 'closed' = 'awaiting-response';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const close = (): void => {
    if (phase === 'closed') return;
    phase = 'closed';
    clearTimer();
    signal.removeEventListener('abort', close);
  };
  const abortForTimeout = (failure: ModelInvocationError): void => {
    if (phase === 'closed' || signal.aborted || options.parentSignal.aborted) return;
    timer = undefined;
    options.onTimeout(failure);
    timeoutController.abort(failure);
  };
  const armTimer = (
    timeoutMilliseconds: Exclude<ProviderTransportTimeoutMilliseconds, null>,
    createFailure: () => ModelInvocationError
  ): void => {
    clearTimer();
    if (phase === 'closed' || signal.aborted) return;
    timer = setTimeout(() => {
      abortForTimeout(createFailure());
    }, timeoutMilliseconds);
  };
  const armStreamIdleTimer = (): void => {
    if (streamIdleTimeout === null) {
      clearTimer();
      return;
    }
    armTimer(
      streamIdleTimeout,
      () =>
        new ModelInvocationError(
          'MODEL_PROVIDER_STREAM_IDLE_TIMEOUT',
          `Provider stream produced no normalized event for ${streamIdleTimeout} milliseconds.`
        )
    );
  };
  const responseStarted = (): void => {
    if (phase !== 'awaiting-response') return;
    phase = 'streaming';
    armStreamIdleTimer();
  };
  const streamEventReceived = (): void => {
    if (phase === 'closed') return;
    if (phase === 'awaiting-response') phase = 'streaming';
    clearTimer();
  };
  const waitForNextStreamEvent = (): void => {
    if (phase === 'streaming') armStreamIdleTimer();
  };

  signal.addEventListener('abort', close, { once: true });
  if (signal.aborted) {
    close();
  } else if (responseStartTimeout !== null) {
    armTimer(
      responseStartTimeout,
      () =>
        new ModelInvocationError(
          'MODEL_PROVIDER_RESPONSE_START_TIMEOUT',
          `Provider response did not start within ${responseStartTimeout} milliseconds.`
        )
    );
  }

  return Object.freeze({
    signal,
    responseStarted,
    streamEventReceived,
    waitForNextStreamEvent,
    close,
  });
}
