import { expect, it } from 'vitest';
import { createCodepointChunker } from '../../../src/index.js';

it.each([
  { window: 4, overlap: 0, content: '        a😀b         ' },
  { window: 4, overlap: 1, content: '\n\n\n\n\na😀b\n\n\n\n\n\n\n' },
])(
  'skips leading/trailing blank windows with overlap=$overlap and keeps exact UTF-16 spans',
  async ({ window, overlap, content }) => {
    const chunks = await createCodepointChunker({ window, overlap }).chunk(
      content,
      new AbortController().signal
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.trim()).not.toBe('');
      expect(chunk.text.isWellFormed()).toBe(true);
      expect(chunk.span).not.toBeNull();
      expect(content.slice(chunk.span!.start, chunk.span!.end)).toBe(chunk.text);
    }
    for (let index = 0; index < content.length; index++)
      if (content[index]!.trim() !== '')
        expect(chunks.some(({ span }) => span!.start <= index && span!.end > index)).toBe(true);
  }
);
