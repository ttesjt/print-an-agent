import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it, onTestFinished } from 'vitest';

it.each([
  { doubleFault: false, closeFault: false },
  { doubleFault: true, closeFault: false },
  { doubleFault: true, closeFault: true },
])(
  'handles worker COMMIT failure with rollback failure = $doubleFault, close failure = $closeFault',
  async ({ doubleFault, closeFault }) => {
    const directory = mkdtempSync(join(tmpdir(), 'retrieval-worker-fault-'));
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    await promisify(execFile)(
      process.execPath,
      [
        '--import',
        new URL('../../support/transaction-fault-preload.ts', import.meta.url).href,
        fileURLToPath(new URL('../../support/poisoned-worker-consumer.ts', import.meta.url)),
        join(directory, 'memory.db'),
      ],
      {
        env: {
          ...process.env,
          RETRIEVAL_TEST_DOUBLE_FAULT: doubleFault ? '1' : '0',
          RETRIEVAL_TEST_CLOSE_FAULT: closeFault ? '1' : '0',
        },
        timeout: 10_000,
      }
    );
  },
  15_000
);
