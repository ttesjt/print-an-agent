import type { ChunkContent } from '../../types/representation.js';

/** Callers validate integer fields and retain the error identity of their own boundary. */
export function matchesSourceSpan(
  content: string,
  chunkText: string,
  span: NonNullable<ChunkContent['span']>
): boolean {
  return (
    span.end > span.start &&
    span.end <= content.length &&
    content.slice(span.start, span.end) === chunkText
  );
}
