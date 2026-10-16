import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SKIP_STEP } from '@ta-agent/workflow-core';
import { textReport, type TextFiles } from '../consumers/text-report.js';

it('runs a standalone file-processing consumer with injected real I/O through public exports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-report-'));
  try {
    await writeFile(join(directory, 'input'), '  HELLO WORKFLOW  ');
    const files: TextFiles = {
      read: (name, signal) => readFile(join(directory, name), { encoding: 'utf8', signal }),
      write: (name, content, signal) => writeFile(join(directory, name), content, { signal }),
    };
    const input = { source: 'input', destination: 'output' };
    expect(await textReport(files).run({ input })).toEqual({ written: ['output'] });
    expect(await readFile(join(directory, 'output'), 'utf8')).toBe('hello workflow');
    await textReport(files, { normalize: SKIP_STEP }).run({ input });
    expect(await readFile(join(directory, 'output'), 'utf8')).toBe('  HELLO WORKFLOW  ');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
