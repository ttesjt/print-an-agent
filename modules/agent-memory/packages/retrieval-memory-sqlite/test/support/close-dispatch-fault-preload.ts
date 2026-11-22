import { isMainThread, Worker } from 'node:worker_threads';

// Isolated subprocess injection keeps a real Worker alive when its close frame cannot be sent.
// eslint-disable-next-line @typescript-eslint/unbound-method -- Rebound with postMessage.call(worker, frame).
const postMessage = Worker.prototype.postMessage;
const failedCloses = new Map<Worker, unknown>();
if (isMainThread) {
  Worker.prototype.postMessage = function (this: Worker, frame: unknown): void {
    if (
      typeof frame === 'object' &&
      frame !== null &&
      'operation' in frame &&
      frame.operation === 'close'
    ) {
      failedCloses.set(this, frame);
      throw new Error('injected close dispatch failure');
    }
    postMessage.call(this, frame);
  };
}

/** Test-only release after checking rejection; never terminate admitted native operations. */
export async function releaseFailedCloses(): Promise<void> {
  await Promise.all(
    [...failedCloses].map(
      ([worker, frame]) =>
        new Promise<void>((resolve, reject) => {
          worker.once('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`Worker exit ${code}`))
          );
          try {
            postMessage.call(worker, frame);
          } catch (cause) {
            reject(
              cause instanceof Error
                ? cause
                : new Error('Test Worker close could not be dispatched.', { cause })
            );
          }
        })
    )
  );
  failedCloses.clear();
}
