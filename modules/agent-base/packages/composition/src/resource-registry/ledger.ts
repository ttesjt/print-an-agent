import { ResourceCleanupError, ResourceError } from './errors.js';
import type { ResourceEntry } from './types/entry.js';

/** Owns acquisitions and failed attempts, including attempts that never produced a value. */
export class AcquisitionLedger {
  readonly entries = new Set<ResourceEntry>();
  readonly #failures = new Set<unknown>();

  constructor(readonly onFailure: (error: ResourceCleanupError) => void) {}

  captureRelease(entry: ResourceEntry): void {
    if (entry.releaseCaptured) return;
    const acquisition = entry.acquisition;
    if (
      ((typeof acquisition === 'object' && acquisition !== null) ||
        typeof acquisition === 'function') &&
      'release' in acquisition
    ) {
      const release = acquisition.release;
      if (release !== undefined) {
        if (!isRelease(release))
          throw new ResourceError(
            'RESOURCE_INITIALIZATION_FAILED',
            'An acquisition release callback is invalid.'
          );
        entry.releaseCallback = () => release.call(acquisition);
      }
    }
    entry.releaseCaptured = true;
  }

  retainFailure(entry: ResourceEntry, error: ResourceCleanupError): void {
    entry.cleanupFailure = error;
    this.#failures.add(error);
    this.onFailure(error);
  }

  release(entry: ResourceEntry, primary?: unknown): Promise<void> {
    if (entry.releasePromise !== undefined) return entry.releasePromise;
    entry.releasePromise = Promise.resolve().then(async () => {
      try {
        this.captureRelease(entry);
        await entry.releaseCallback?.();
      } catch (cause) {
        const error = new ResourceCleanupError({ primary, failures: [cause] });
        this.retainFailure(entry, error);
        throw error;
      }
    });
    return entry.releasePromise;
  }

  async close(): Promise<void> {
    const ordered: ResourceEntry[] = [];
    const visited = new Set<ResourceEntry>();
    const visit = (entry: ResourceEntry): void => {
      if (visited.has(entry)) return;
      visited.add(entry);
      for (const dependency of entry.dependencies) visit(dependency);
      if (this.entries.has(entry)) ordered.push(entry);
    };
    for (const entry of this.entries) visit(entry);
    const blocked = new Set<ResourceEntry>();
    const protect = (entry: ResourceEntry): void => {
      for (const dependency of entry.dependencies) {
        if (blocked.has(dependency)) continue;
        blocked.add(dependency);
        protect(dependency);
      }
    };
    for (const entry of this.entries) {
      if (entry.cleanupFailure !== undefined) protect(entry);
    }
    for (const entry of ordered.reverse()) {
      if (entry.cleanupFailure !== undefined || blocked.has(entry)) continue;
      try {
        await this.release(entry);
        // Closed independent branches need no live cache. Keep only unresolved ownership/edges.
        this.entries.delete(entry);
        entry.dependencies.clear();
        delete entry.acquisition;
        delete entry.releaseCallback;
      } catch {
        protect(entry);
      }
    }
    if (this.#failures.size !== 0) {
      throw new ResourceCleanupError({
        failures: [...this.#failures],
        blocked: [...blocked]
          .filter((entry) => this.entries.has(entry))
          .map((entry) => entry.token.name),
      });
    }
    this.entries.clear();
  }
}

function isRelease(value: unknown): value is (this: unknown) => unknown {
  return typeof value === 'function';
}
