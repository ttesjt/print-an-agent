import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  inspectSourceCycles,
  type SourceModule,
  type SourceBoundary,
  type SourceDependencyRule,
} from '../tooling/architecture/source-boundaries.js';
import { inspectTypeModules } from '../tooling/architecture/type-modules.js';
const root = fileURLToPath(
  new URL('../modules/agent-memory/packages/context-memory-sqlite/src/', import.meta.url)
);
const features = [
  'store',
  'database',
  'database/connection',
  'database/persistence',
  'database/history',
  'database/history/delta',
  'database/publication',
];
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'] },
  ...features.map((directory) => ({ directory, entries: ['index.ts'] })),
];
const rules: readonly SourceDependencyRule[] = [
  { scope: 'store', dependencies: ['database'] },
  { scope: 'database', dependencies: [] },
  { scope: 'database/connection', dependencies: [] },
  { scope: 'database/persistence', dependencies: [] },
  { scope: 'database/history', dependencies: ['database/persistence'] },
  { scope: 'database/history/delta', dependencies: [] },
  { scope: 'database/publication', dependencies: ['database/persistence', 'database/history'] },
];
function modules(directory: string): SourceModule[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory()
      ? modules(file)
      : entry.name.endsWith('.ts')
        ? [{ path: relative(root, file).split(sep).join('/'), source: readFileSync(file, 'utf8') }]
        : [];
  });
}
it('keeps every enclosing SQLite feature on declared one-way APIs', () => {
  const sources = modules(root);
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
  const paths = sources.map((source) => source.path);
  for (const boundary of boundaries)
    for (const entry of boundary.entries)
      expect(paths).toContain(join(boundary.directory, entry).split(sep).join('/'));
});
it('keeps SQLite source dependencies acyclic, including type-only edges', () => {
  expect(inspectSourceCycles(modules(root))).toEqual([]);
});
it('keeps independent SQLite type modules erased at runtime', () => {
  expect(inspectTypeModules(modules(root))).toEqual([]);
});
it.each([
  ['index.ts', './database/index.js', true],
  ['database/index.ts', './connection/index.js', true],
  ['database/index.ts', './persistence/index.js', true],
  ['database/index.ts', './publication/index.js', true],
  ['database/index.ts', './history/index.js', true],
  ['database/initialize-schema.ts', './persistence/index.js', true],
  ['database/publication/commit.ts', '../persistence/index.js', true],
  ['store/sqlite-memory-store.ts', '../database/index.js', true],
  ['store/types.ts', '../database/index.js', true],
  ['database/initialize-schema.ts', './history/index.js', true],
  ['index.ts', './database/connection/index.js', false],
  ['index.ts', './database/history/index.js', false],
  ['store/types.ts', '../database/history/index.js', false],
  ['store/types.ts', '../database/connection/types.js', false],
  ['store/sqlite-memory-store.ts', '../database/initialize-schema.js', false],
  ['database/index.ts', './connection/lifecycle.js', false],
  ['database/initialize-schema.ts', './history/schema.js', false],
  ['database/connection/lifecycle.ts', '../initialize-schema.js', false],
  ['database/persistence/schema.ts', '../initialize-schema.js', false],
  ['database/history/read-version.ts', '../index.js', false],
  ['database/publication/types.ts', '../index.js', false],
  ['database/history/delta/types.ts', '../../index.js', false],
  ['database/history/delta/apply.ts', '../../persistence/index.js', false],
  ['database/connection/open.ts', '../history/index.js', false],
  ['database/connection/lifecycle.ts', '../publication/index.js', false],
  ['database/persistence/receipts.ts', '../../store/index.js', false],
  ['store/sqlite-memory-store.ts', '../database/connection/index.js', false],
  ['database/index.ts', '../store/index.js', false],
  ['database/history/read-version.ts', './records.js', true],
  ['database/history/upgrade-legacy.ts', '../persistence/index.js', true],
  ['database/publication/publish-snapshot.ts', '../history/index.js', true],
  ['database/history/codec.ts', './delta/index.js', true],
  ['database/history/delta/apply.ts', './types.js', true],
  ['store/sqlite-memory-store.ts', '../database/history/read-version.js', false],
  ['database/history/delta/apply.ts', '../codec.js', false],
  ['database/history/delta/types.ts', '../index.js', false],
  ['database/history/delta/types.ts', '../types/record.js', false],
  ['database/connection/lifecycle.ts', '../../store/index.js', false],
  ['database/persistence/snapshots.ts', '../history/index.js', false],
  ['database/history/append-version.ts', '../publication/index.js', false],
  ['index.ts', './database/history/delta/index.js', false],
  ['database/publication/run-transaction.ts', '../../store/index.js', false],
  ['store/sqlite-memory-store.ts', './index.js', false],
  ['database/connection/open.ts', '../index.js', false],
] as const)('qualifies the boundary from %s to %s (allowed=%s)', (path, specifier, allowed) => {
  // Imports and re-exports obey the same boundaries, including erased type-only edges.
  // Probe symbols are synthetic; the compiler separately owns actual symbol correctness.
  for (const source of [
    `import type { Contract } from '${specifier}';`,
    `import { value } from '${specifier}';`,
    `export type { Contract } from '${specifier}';`,
    `export { value } from '${specifier}';`,
  ]) {
    const violations = inspectSourceBoundaries([{ path, source }], boundaries, rules);
    if (allowed) expect(violations).toEqual([]);
    else expect(violations.length).toBeGreaterThan(0);
  }
});
