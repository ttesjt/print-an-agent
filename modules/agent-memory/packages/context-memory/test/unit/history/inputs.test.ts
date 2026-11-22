import { expect, it } from 'vitest';
import {
  parseMemoryVersionReference,
  parseForkMemoryInput,
  parseListMemoryVersionsInput,
} from '@print-an-agent/context-memory';

it('validates exact version references rather than falling back to head', () => {
  expect(parseMemoryVersionReference({ memoryId: 'm', revision: 2 })).toEqual({
    memoryId: 'm',
    revision: 2,
  });
  for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined])
    expect(() => parseMemoryVersionReference({ memoryId: 'm', revision })).toThrow();
  expect(() =>
    parseMemoryVersionReference({ memoryId: 'm', revision: 2, branchId: 'b' })
  ).toThrow();
});

it('binds fork identity to an explicit source and rejects self fork', () => {
  expect(
    parseForkMemoryInput({
      memoryId: 'child',
      requestId: 'fork',
      source: { memoryId: 'parent', revision: 2 },
    }).source.revision
  ).toBe(2);
  expect(() =>
    parseForkMemoryInput({
      memoryId: 'parent',
      requestId: 'fork',
      source: { memoryId: 'parent', revision: 2 },
    })
  ).toThrow();
});

it('bounds history pages and cursor size', () => {
  expect(parseListMemoryVersionsInput({ memoryId: 'm' }).limit).toBe(20);
  expect(() => parseListMemoryVersionsInput({ memoryId: 'm', limit: 101 })).toThrow();
  expect(() => parseListMemoryVersionsInput({ memoryId: 'm', cursor: 'x'.repeat(4097) })).toThrow();
});
