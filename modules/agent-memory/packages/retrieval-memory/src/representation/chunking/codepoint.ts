import { DEFAULT_CHUNK_WINDOW_CODEPOINTS, DEFAULT_CHUNK_OVERLAP_CODEPOINTS } from './defaults.js';
import type { RetrievalChunker } from './types.js';
import { assertNotAborted, fail } from '../../errors.js';
import { integer, text } from '../../values/index.js';

export function createCodepointChunker(
  options: { window?: number; overlap?: number } = {}
): RetrievalChunker {
  const window = integer(options.window ?? DEFAULT_CHUNK_WINDOW_CODEPOINTS);
  const overlap = integer(options.overlap ?? DEFAULT_CHUNK_OVERLAP_CODEPOINTS, 0);
  if (overlap >= window) fail('CONFIG_INVALID', 'Chunk overlap must be smaller than its window.');
  return Object.freeze({
    ref: `codepoint-window:v1:${window}:${overlap}`,
    chunk(content: string, signal: AbortSignal) {
      assertNotAborted(signal);
      text(content, true);
      const points = [...content];
      const offsets = [0];
      for (const point of points) offsets.push(offsets[offsets.length - 1]! + point.length);
      const chunks = [];
      for (let start = 0; start < points.length; start += window - overlap) {
        const end = Math.min(start + window, points.length);
        const span = { start: offsets[start]!, end: offsets[end]! };
        const chunkText = content.slice(span.start, span.end);
        if (chunkText.trim() !== '') chunks.push({ text: chunkText, span });
        if (end === points.length) break;
      }
      return Promise.resolve(chunks);
    },
  });
}
