import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  type SourceBoundary,
  type SourceDependencyRule,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';

const sourceRoot = fileURLToPath(
  new URL('../modules/agent-base/packages/session/src/', import.meta.url)
);
const features = [
  'contracts',
  'turns',
  'compaction',
  'navigation',
  'lifecycle',
  'query',
  'metadata',
  'presentation',
  'context-memory',
];
const boundaries: readonly SourceBoundary[] = [
  {
    directory: '',
    entries: ['index.ts'],
    sharedEntries: ['errors.ts', 'lineage.ts', 'types/errors.ts'],
  },
  ...features.map((directory) => ({
    directory,
    entries: ['index.ts'],
    sharedEntries:
      directory === 'compaction'
        ? [
            'types/policy.ts',
            'types/projection.ts',
            'types/ports.ts',
            'types/source.ts',
            'types/input.ts',
            'types/outcome.ts',
            'types/assessment.ts',
            'types/token-measurement.ts',
            'rejection-reasons.ts',
            'errors.ts',
            'input.ts',
            'policy.ts',
            'source-selection.ts',
            'token-measurement.ts',
            'planning/target.ts',
            'planning/types.ts',
            'planning/feedback.ts',
          ]
        : directory === 'navigation'
          ? [
              'types/command.ts',
              'types/outcome.ts',
              'types/ports.ts',
              'types/coordinator.ts',
              'snapshot.ts',
              'errors.ts',
            ]
          : [],
  })),
  { directory: 'validation', entries: ['authority-record.ts', 'data-record.ts'] },
  { directory: 'lifecycle/state', entries: ['index.ts'] },
  { directory: 'lifecycle/execution', entries: ['index.ts'] },
  { directory: 'navigation/execution', entries: ['index.ts'] },
  { directory: 'navigation/workflow', entries: ['index.ts'] },
  {
    directory: 'compaction/workflow',
    entries: ['index.ts'],
    sharedEntries: ['types.ts', 'state-access.ts', 'names.ts'],
  },
  { directory: 'compaction/workflow/steps/build-compacted-context', entries: ['index.ts'] },
];

const dependencyRules: readonly SourceDependencyRule[] = [
  { scope: 'contracts', dependencies: ['errors.ts', 'validation'] },
  { scope: 'validation', dependencies: ['errors.ts', 'types/errors.ts'] },
  { scope: 'lineage.ts', dependencies: ['contracts', 'errors.ts'] },
  { scope: 'turns', dependencies: ['contracts', 'lifecycle'] },
  {
    scope: 'compaction',
    dependencies: ['contracts', 'lifecycle', 'errors.ts', 'lineage.ts', 'validation'],
  },
  { scope: 'navigation', dependencies: ['contracts', 'lifecycle', 'errors.ts', 'validation'] },
  { scope: 'lifecycle', dependencies: ['contracts', 'query', 'errors.ts', 'validation'] },
  { scope: 'query', dependencies: ['contracts', 'errors.ts'] },
  { scope: 'metadata', dependencies: ['contracts', 'query', 'errors.ts'] },
  { scope: 'presentation', dependencies: ['contracts', 'turns', 'errors.ts', 'validation'] },
  { scope: 'context-memory', dependencies: ['contracts', 'lifecycle', 'navigation', 'errors.ts'] },
];

function readModules(directory: string): readonly SourceModule[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readModules(path);
    return entry.name.endsWith('.ts')
      ? [
          {
            path: relative(sourceRoot, path).split(sep).join('/'),
            source: readFileSync(path, 'utf8'),
          },
        ]
      : [];
  });
}

it('declares every Session feature entry and keeps public declarations backed by files', () => {
  const paths = readModules(sourceRoot).map((module) => module.path);
  const declared = boundaries.flatMap((boundary) =>
    boundary.entries.map((entry) => posix.join(boundary.directory, entry))
  );
  const shared = boundaries.flatMap((boundary) =>
    (boundary.sharedEntries ?? []).map((entry) => posix.join(boundary.directory, entry))
  );
  for (const entry of [...declared, ...shared]) expect(paths, entry).toContain(entry);
  expect(paths.filter((path) => path.endsWith('index.ts')).sort()).toEqual(
    declared.filter((path) => path.endsWith('index.ts')).sort()
  );
});

it('keeps Session features on explicit public/shared entries and declared dependency directions', () => {
  expect(inspectSourceBoundaries(readModules(sourceRoot), boundaries, dependencyRules)).toEqual([]);
});
