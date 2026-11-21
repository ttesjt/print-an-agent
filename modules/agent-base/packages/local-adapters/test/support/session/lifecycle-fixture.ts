import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySessionAdapter, SqliteSessionAdapter } from '../../../src/index.js';

export const agentId = parseAgentId('lifecycle-owner');

export function fixture(
  kind: 'memory' | 'sqlite',
  clock: () => number = () => 100
): {
  readonly adapter: MemorySessionAdapter | SqliteSessionAdapter;
  readonly databasePath: string;
  dispose(): void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'session-lifecycle-'));
  const databasePath = join(directory, 'agent.sqlite');
  const adapter =
    kind === 'memory'
      ? new MemorySessionAdapter({ clock })
      : new SqliteSessionAdapter({ databasePath, clock });
  return {
    adapter,
    databasePath,
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}
