import { matchesSourceSpan } from './span.js';
import type { ChunkContent } from '../../types/representation.js';
import { fail } from '../../errors.js';
import { exact, integer, record, text } from '../../values/index.js';

export function parseChunkContent(value: unknown, content: string): ChunkContent {
  const data = record(value);
  exact(data, ['text', 'span']);
  const chunkText = text(data.text, true);
  if (data.span === null) return { text: chunkText, span: null };
  const span = record(data.span);
  exact(span, ['start', 'end']);
  const start = integer(span.start, 0);
  const end = integer(span.end);
  if (!matchesSourceSpan(content, chunkText, { start, end }))
    fail('REPRESENTATION_INVALID', 'Chunk does not have an exact source span.');
  return { text: chunkText, span: { start, end } };
}
