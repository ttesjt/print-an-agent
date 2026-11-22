import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'vitest';

it('rejects a failed close dispatch without waiting for an exit that was never requested', async () => {
  await promisify(execFile)(
    process.execPath,
    [
      '--import',
      new URL('../../support/close-dispatch-fault-preload.ts', import.meta.url).href,
      fileURLToPath(new URL('../../support/close-dispatch-fault-consumer.ts', import.meta.url)),
    ],
    { timeout: 10_000 }
  );
}, 15_000);

it.each(['exit', 'protocol'])(
  'settles pending calls and releases the Worker after %s failure',
  async (mode) => {
    await promisify(execFile)(
      process.execPath,
      [
        '--import',
        new URL('../../support/client-fault-preload.ts', import.meta.url).href,
        fileURLToPath(new URL('../../support/client-fault-consumer.ts', import.meta.url)),
      ],
      { env: { ...process.env, RETRIEVAL_TEST_CLIENT_FAULT: mode }, timeout: 10_000 }
    );
  },
  15_000
);
