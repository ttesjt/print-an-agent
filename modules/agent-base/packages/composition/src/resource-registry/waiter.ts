import { ResourceError } from './errors.js';

export function aborted(): ResourceError {
  return new ResourceError(
    'RESOURCE_OPERATION_ABORTED',
    'Resource waiting or initialization was cancelled.'
  );
}

/** Detaches one waiter; the Scope, not this Promise, retains initialization ownership. */
export function waitForResource(work: Promise<unknown>, signal?: AbortSignal): Promise<unknown> {
  if (signal === undefined) return work;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = (): void => {
      signal.removeEventListener('abort', cancel);
      reject(aborted());
    };
    signal.addEventListener('abort', cancel, { once: true });
    void work.then(
      (value) => {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', cancel);
        reject(
          error instanceof Error
            ? error
            : new ResourceError(
                'RESOURCE_INITIALIZATION_FAILED',
                'Resource initialization failed.',
                { cause: error }
              )
        );
      }
    );
    if (signal.aborted) cancel();
  });
}
