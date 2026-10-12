const SUPERSEDED_OPERATION = 'Superseded by a newer operation.';

/**
 * App-private ownership for cancellable async work. It provides identity and cleanup, not domain
 * retry, scheduling, or transport semantics.
 */
export class KeyedOperationOwnership {
  readonly #controllers = new Map<string, AbortController>();

  begin(key: string): AbortController {
    this.abort(key, SUPERSEDED_OPERATION);
    const controller = new AbortController();
    this.#controllers.set(key, controller);
    return controller;
  }

  beginIfIdle(key: string): AbortController | undefined {
    if (this.#controllers.has(key)) return undefined;
    return this.begin(key);
  }

  isPending(key: string): boolean {
    return this.#controllers.has(key);
  }

  /** Transfer the same operation's ownership, without cancelling it or displacing another owner. */
  move(key: string, controller: AbortController, nextKey: string): boolean {
    if (!this.isCurrent(key, controller)) return false;
    if (key === nextKey) return true;
    if (this.isPending(nextKey)) return false;
    this.#controllers.delete(key);
    this.#controllers.set(nextKey, controller);
    return true;
  }

  abort(key: string, message: string): void {
    const controller = this.#controllers.get(key);
    if (controller === undefined) return;
    this.#controllers.delete(key);
    controller.abort(new DOMException(message, 'AbortError'));
  }

  cancel(key: string, message: string): void {
    this.#controllers.get(key)?.abort(new DOMException(message, 'AbortError'));
  }

  abortAll(message: string): void {
    for (const key of [...this.#controllers.keys()]) this.abort(key, message);
  }

  complete(key: string, controller: AbortController): void {
    if (this.#controllers.get(key) === controller) this.#controllers.delete(key);
  }

  isCurrent(key: string, controller: AbortController): boolean {
    return this.#controllers.get(key) === controller;
  }
}
