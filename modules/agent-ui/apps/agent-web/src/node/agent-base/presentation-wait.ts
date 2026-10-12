/** A read-only UI projection budget, not a model/Request deadline or a rollback mechanism. */
export const DEFAULT_PRESENTATION_WAIT_MILLISECONDS = 1_000;

export function validatePresentationWait(milliseconds: number): number {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647)
    throw new Error('Presentation wait must be a positive timer-safe integer.');
  return milliseconds;
}

/** Stops waiting only. Session read APIs cannot currently cancel their underlying I/O. */
export async function awaitCommittedPresentation<Value>(
  read: () => Promise<Value>,
  milliseconds: number
): Promise<Value> {
  validatePresentationWait(milliseconds);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Committed presentation needs recovery.')),
      milliseconds
    );
  });
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
