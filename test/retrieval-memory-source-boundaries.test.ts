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
  new URL('../modules/agent-memory/packages/retrieval-memory/src/', import.meta.url)
);
const common = [
  'errors.ts',
  'mutation-operations.ts',
  'types/json.ts',
  'types/identity.ts',
  'types/entry.ts',
  'types/space.ts',
  'types/representation.ts',
  'types/mutation.ts',
  'types/publication.ts',
  'types/search.ts',
];
const features = [
  'values',
  'policy',
  'content',
  'filters',
  'representation',
  'representation/chunking',
  'representation/embedding',
  'persistence',
  'mutations',
  'queries',
  'queries/content',
  'queries/search',
  'context',
  'workflows',
  'workflows/shared',
  'workflows/mutation',
  'workflows/query',
  'workflows/context',
  'workflows/content',
];
const metric = 'representation/metric.ts';
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: common },
  ...features.map((directory) => ({
    directory,
    entries: directory === 'representation' ? ['index.ts', 'metric.ts'] : ['index.ts'],
    ...(directory === 'representation' ? { sharedEntries: ['metric.ts'] } : {}),
  })),
];
const rules: readonly SourceDependencyRule[] = [
  ...common.map((scope) => ({ scope, dependencies: common })),
  { scope: 'values', dependencies: common },
  { scope: 'policy', dependencies: [...common, 'values'] },
  { scope: 'content', dependencies: [...common, 'values', 'policy', metric] },
  { scope: 'filters', dependencies: [...common, 'values', 'policy'] },
  { scope: 'representation', dependencies: [...common, 'values', 'policy'] },
  { scope: 'representation/chunking', dependencies: [...common, 'values'] },
  { scope: 'representation/embedding', dependencies: [...common, 'values', 'policy', metric] },
  {
    scope: 'persistence',
    dependencies: [...common, 'values', 'policy', 'content', 'filters', 'representation'],
  },
  {
    scope: 'mutations',
    dependencies: [...common, 'values', 'policy', 'content', 'representation', 'persistence'],
  },
  {
    scope: 'queries',
    dependencies: [
      ...common,
      'values',
      'policy',
      'content',
      'filters',
      'representation',
      'persistence',
    ],
  },
  {
    scope: 'queries/content',
    dependencies: [...common, 'values', 'policy', 'filters', 'persistence'],
  },
  {
    scope: 'queries/search',
    dependencies: [
      ...common,
      'values',
      'policy',
      'content',
      'filters',
      'representation',
      'persistence',
    ],
  },
  { scope: 'context', dependencies: [...common, 'values', 'policy', 'queries'] },
  {
    scope: 'workflows',
    dependencies: [...common, 'values', 'policy', 'persistence', 'mutations', 'queries', 'context'],
  },
  { scope: 'workflows/shared', dependencies: [...common, 'values', 'persistence'] },
  {
    scope: 'workflows/mutation',
    dependencies: [...common, 'mutations', 'persistence', 'workflows/shared'],
  },
  { scope: 'workflows/query', dependencies: [...common, 'queries', 'workflows/shared'] },
  { scope: 'workflows/context', dependencies: [...common, 'context', 'workflows/shared'] },
  {
    scope: 'workflows/content',
    dependencies: [
      ...common,
      'policy',
      'persistence',
      'mutations',
      'queries',
      'workflows/shared',
      'workflows/query',
      'workflows/mutation',
    ],
  },
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
it('keeps Retrieval Memory on deliberate feature APIs with one-way dependencies', () => {
  const sources = modules(root);
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
  const paths = sources.map((source) => source.path);
  for (const boundary of boundaries)
    for (const entry of [...boundary.entries, ...(boundary.sharedEntries ?? [])])
      expect(paths).toContain(join(boundary.directory, entry).split(sep).join('/'));
});
it('keeps Retrieval Memory source dependencies acyclic, including type-only edges', () => {
  expect(inspectSourceCycles(modules(root))).toEqual([]);
});
it('keeps independent Retrieval Memory type modules erased at runtime', () => {
  expect(inspectTypeModules(modules(root))).toEqual([]);
});
it.each([
  ['mutations/prepare-candidate.ts', '../persistence/index.js', true],
  ['content/space.ts', '../representation/metric.js', true],
  ['representation/embedding/embed-texts.ts', '../metric.js', true],
  ['queries/create-queries.ts', './search/index.js', true],
  ['workflows/mutation/step-definitions.ts', '../shared/index.js', true],
  ['workflows/content/create-bundle.ts', '../query/index.js', true],
  ['types/publication.ts', './mutation.js', true],
  ['content/space.ts', '../representation/index.js', false],
  ['mutations/prepare-candidate.ts', '../persistence/access.js', false],
  ['mutations/prepare-candidate.ts', '../representation/embedding/index.js', false],
  ['representation/embedding/embed-texts.ts', '../index.js', false],
  ['representation/chunking/codepoint.ts', '../validation.js', false],
  ['queries/content/types.ts', '../types.js', false],
  ['queries/content/create-queries.ts', '../search/index.js', false],
  ['persistence/decide-publication.ts', '../mutations/index.js', false],
  ['workflows/shared/outcomes.ts', '../mutation/index.js', false],
  ['workflows/context/types.ts', '../types/resources.js', false],
  ['context/create-context.ts', '../workflows/index.js', false],
  ['values/json.ts', '../policy/index.js', false],
  ['types/entry.ts', '../queries/index.js', false],
  ['mutations/create-mutations.ts', '../index.js', false],
] as const)('qualifies the boundary from %s to %s (allowed=%s)', (path, specifier, allowed) => {
  const sources = [{ path, source: "import type { Contract } from '" + specifier + "';" }];
  const violations = inspectSourceBoundaries(sources, boundaries, rules);
  if (allowed) expect(violations).toEqual([]);
  else expect(violations.length).toBeGreaterThan(0);
});
