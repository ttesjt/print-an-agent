import { expect, it } from 'vitest';
import {
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
} from '@print-an-agent/retrieval-memory';
import { fixture } from '../../support/fixture.js';

it.each([' ', '\n'])(
  'ingests long %j windows without changing source content or nonblank spans',
  async (whitespace) => {
    const f = await fixture();
    await f.create();
    const content = `hello😀${whitespace.repeat(2500)}world😀`;
    const bundle = createRetrievalMemoryBundle({
      resources: createRetrievalWorkflowResources(f.resources),
    });
    const result = await bundle.workflows.ingest.run({
      input: { memoryId: 'space', requestId: 'spaced', content },
    });
    if (result.status === 'skipped') throw new Error('Unexpected skip');
    const stored = await f.backend.get('space', result.receipt.entryId!);
    expect(stored?.entry.content).toBe(content);
    expect(stored?.representation.chunks).toHaveLength(2);
    for (const chunk of stored!.representation.chunks) {
      expect(chunk.text.trim()).not.toBe('');
      expect(chunk.span).not.toBeNull();
      expect(content.slice(chunk.span!.start, chunk.span!.end)).toBe(chunk.text);
      expect(chunk.text.isWellFormed()).toBe(true);
    }
    expect((await f.search()).hits).toHaveLength(2);
    expect((await f.backend.getReceipt('space', 'spaced'))?.sequence).toBe(1);
  }
);
