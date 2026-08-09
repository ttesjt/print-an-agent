import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readNodeStandardInput } from '../../src/node-process.js';

describe('Agent Base CLI process adapters', () => {
  it('reads bounded UTF-8 standard input', async () => {
    await expect(
      readNodeStandardInput(Readable.from(['first ', 'second']), new AbortController().signal)
    ).resolves.toBe('first second');
  });

  it('rejects standard input larger than 64 KiB before Agent invocation', async () => {
    await expect(
      readNodeStandardInput(Readable.from(['x'.repeat(65_537)]), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'CLI_INPUT_INVALID' });
  });
});
