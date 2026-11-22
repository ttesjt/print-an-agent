import { jsonSnapshot } from '../../values/index.js';

/** Validate JSON without invoking accessors, then detach mutable per-run state from caller input. */
export function detachRetrievalInput<I>(input: I): I {
  jsonSnapshot(input);
  return structuredClone(input);
}
