import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  inspectSourceCycles,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';
import { inspectTypeModules } from '../tooling/architecture/type-modules.js';

const root = fileURLToPath(
  new URL('../modules/agent-memory/packages/context-memory/src/', import.meta.url)
);
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
it('keeps Context Memory source dependencies acyclic, including type-only edges', () => {
  expect(inspectSourceCycles(modules(root))).toEqual([]);
});
it('keeps independent Context Memory type modules erased at runtime', () => {
  expect(inspectTypeModules(modules(root))).toEqual([]);
});
