import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function hostConfig(input: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-web-host-'));
  const filename = join(directory, 'host.json');
  await writeFile(filename, JSON.stringify(input));
  return { filename, close: () => rm(directory, { recursive: true, force: true }) };
}
