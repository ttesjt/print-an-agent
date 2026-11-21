import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  type SourceBoundary,
  type SourceDependencyRule,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';
import { inspectTypeModules } from '../tooling/architecture/type-modules.js';

const sourceRoot = fileURLToPath(
  new URL('../modules/agent-base/packages/observability/src/', import.meta.url)
);
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: ['errors.ts'] },
  { directory: 'events', entries: ['index.ts'] },
  { directory: 'emission', entries: ['index.ts'] },
];
const dependencies: readonly SourceDependencyRule[] = [
  { scope: 'events', dependencies: ['errors.ts'] },
  { scope: 'emission', dependencies: ['events', 'errors.ts'] },
  { scope: 'emission/types', dependencies: ['events'] },
  { scope: 'errors.ts', dependencies: [] },
];

function sources(directory: string): readonly SourceModule[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : entry.name.endsWith('.ts')
        ? [
            {
              path: relative(sourceRoot, path).split(sep).join('/'),
              source: readFileSync(path, 'utf8'),
            },
          ]
        : [];
  });
}

it('keeps event protocol and emission on explicit entries with one-way dependencies', () => {
  const modules = sources(sourceRoot);
  expect(inspectSourceBoundaries(modules, boundaries, dependencies)).toEqual([]);
  expect(inspectTypeModules(modules)).toEqual([]);
  const paths = modules.map((module) => module.path);
  for (const boundary of boundaries) {
    for (const entry of [...boundary.entries, ...(boundary.sharedEntries ?? [])]) {
      expect(paths).toContain(join(boundary.directory, entry).split(sep).join('/'));
    }
  }
});

it('retains one npm entry and no production dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, '../package.json'), 'utf8')) as {
    exports: Record<string, { types: string; import: string }>;
    dependencies: Record<string, string>;
  };
  expect(manifest.exports).toEqual({
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  });
  expect(manifest.dependencies).toEqual({});
});

it.each([
  ['emission/emitter.ts', "import { snapshotAgentTraceEventDetails } from '../events/index.js';"],
  ['events/validation.ts', "import { AgentObservabilityError } from '../errors.js';"],
  ['emission/types/ports.ts', "import type { AgentTraceEvent } from '../../events/index.js';"],
])('accepts the declared dependency in %s', (path, source) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, dependencies)).toEqual([]);
});

it.each([
  ['emission/emitter.ts', "import '../events/validation.js';", 'private-entry'],
  ['events/validation.ts', "import '../emission/index.js';", 'dependency'],
  [
    'events/types.ts',
    "import type { AgentTraceEmitter } from '../emission/index.js';",
    'dependency',
  ],
  ['events/error-code.ts', "import '../index.js';", 'ancestor-entry'],
  ['emission/types/options.ts', "import '../emitter.js';", 'dependency'],
  ['errors.ts', "import './events/index.js';", 'dependency'],
  ['index.ts', "export type * from './events/index.js';", 'wildcard'],
])('rejects the forbidden dependency in %s (%s)', (path, source, rule) => {
  expect(
    inspectSourceBoundaries([{ path, source }], boundaries, dependencies).some(
      (violation) => violation.rule === rule
    )
  ).toBe(true);
});
