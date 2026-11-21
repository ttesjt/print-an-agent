/** Serialization is shared only by the two ports of one coordinated in-process profile. */
export class MemoryPersistenceQueue {
  #tail: Promise<void> = Promise.resolve();

  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(action);
    this.#tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
