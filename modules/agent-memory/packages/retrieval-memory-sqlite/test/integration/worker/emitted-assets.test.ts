import { execFile } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'vitest';

it('opens and drains an emitted backend without any stale JavaScript assets', async () => {
  const pkg = fileURLToPath(new URL('../../../', import.meta.url));
  const artifact = mkdtempSync(join(tmpdir(), 'retrieval-artifact-'));
  try {
    writeFileSync(join(artifact, 'package.json'), JSON.stringify({ type: 'module' }));
    symlinkSync(join(pkg, 'node_modules'), join(artifact, 'node_modules'), 'dir');
    const source = join(pkg, 'src');
    function copyCurrentOutputs(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) copyCurrentOutputs(file);
        else if (entry.name.endsWith('.ts')) {
          const output = relative(source, file).replace(/\.ts$/u, '.js');
          mkdirSync(dirname(join(artifact, output)), { recursive: true });
          copyFileSync(join(pkg, 'dist', output), join(artifact, output));
        }
      }
    }
    // Copy exactly the current source inventory, excluding deleted modules left in an old dist.
    copyCurrentOutputs(source);
    const consumer = join(artifact, 'consumer.mjs');
    writeFileSync(
      consumer,
      `
      import assert from 'node:assert/strict';
      import { openSqliteRetrievalBackend } from './index.js';
      const backend = await openSqliteRetrievalBackend({ path: ':memory:' });
      try { assert.equal(await backend.inspect('absent'), undefined); }
      finally { await backend.close(); }
    `
    );
    await promisify(execFile)(process.execPath, [consumer], { cwd: artifact, timeout: 10_000 });
  } finally {
    rmSync(artifact, { recursive: true, force: true });
  }
}, 15_000);
