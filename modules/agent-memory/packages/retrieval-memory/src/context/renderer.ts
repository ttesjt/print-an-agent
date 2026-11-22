import type { RetrievalContextRenderer } from './types/rendering.js';
import { assertNotAborted } from '../errors.js';

export const DEFAULT_RETRIEVAL_RENDERER: RetrievalContextRenderer = Object.freeze({
  ref: 'retrieval-numbered-citations:v1',
  render(
    { hits, separator }: Parameters<RetrievalContextRenderer['render']>[0],
    signal: AbortSignal
  ) {
    assertNotAborted(signal);
    return hits
      .map(
        (hit, i) => `[${i + 1}] ${hit.source?.label ?? hit.source?.ref ?? hit.entryId}\n${hit.text}`
      )
      .join(separator);
  },
});
