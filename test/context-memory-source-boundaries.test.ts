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
  new URL('../modules/agent-memory/packages/context-memory/src/', import.meta.url)
);
const common = [
  'errors.ts',
  'mutation-operations.ts',
  'types/json.ts',
  'types/document.ts',
  'types/receipt.ts',
  'types/errors.ts',
];
const features = [
  'values',
  'document',
  'measurement',
  'budget',
  'persistence',
  'mutations',
  'context',
  'history',
  'model-update',
  'model-update/planner',
  'model-update/policy',
  'workflows',
  'workflows/shared',
  'workflows/state',
  'workflows/deterministic',
  'workflows/model-driven',
  'workflows/history',
  'workflows/versioned',
];
const modelContracts = [
  'model-update/types/input.ts',
  'model-update/types/planner.ts',
  'model-update/types/operations.ts',
];
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: common },
  ...features.map((directory) => ({
    directory,
    entries: ['index.ts'],
    ...(directory === 'model-update'
      ? { sharedEntries: modelContracts.map((path) => path.slice('model-update/'.length)) }
      : {}),
  })),
];
const rules: readonly SourceDependencyRule[] = [
  ...common.map((scope) => ({ scope, dependencies: common })),
  { scope: 'values', dependencies: common },
  { scope: 'budget', dependencies: [...common, 'values'] },
  { scope: 'document', dependencies: [...common, 'values', 'budget'] },
  { scope: 'measurement', dependencies: [...common, 'values', 'document'] },
  { scope: 'persistence', dependencies: [...common, 'values', 'document'] },
  {
    scope: 'mutations',
    dependencies: [...common, 'values', 'document', 'measurement', 'budget', 'persistence'],
  },
  { scope: 'context', dependencies: [...common, 'values', 'measurement', 'budget', 'persistence'] },
  {
    scope: 'history',
    dependencies: [...common, 'values', 'document', 'context', 'measurement', 'persistence'],
  },
  {
    scope: 'model-update',
    dependencies: [
      ...common,
      'values',
      'document',
      'measurement',
      'budget',
      'persistence',
      'mutations',
    ],
  },
  {
    scope: 'model-update/planner',
    dependencies: [...common, ...modelContracts, 'values', 'document'],
  },
  { scope: 'model-update/policy', dependencies: [...common, 'values'] },
  {
    scope: 'workflows',
    dependencies: [
      ...common,
      'values',
      'document',
      'measurement',
      'budget',
      'persistence',
      'mutations',
      'context',
      'history',
      'model-update',
    ],
  },
  { scope: 'workflows/shared', dependencies: [...common, 'values', 'persistence'] },
  {
    scope: 'workflows/state',
    dependencies: [...common, 'values', 'persistence', 'mutations', 'workflows/shared'],
  },
  {
    scope: 'workflows/deterministic',
    dependencies: [...common, 'mutations', 'context', 'workflows/shared', 'workflows/state'],
  },
  {
    scope: 'workflows/model-driven',
    dependencies: [
      'budget',
      ...common,
      'model-update',
      'mutations',
      'workflows/shared',
      'workflows/deterministic',
    ],
  },
  {
    scope: 'workflows/history',
    dependencies: [...common, 'history', 'workflows/shared', 'workflows/state'],
  },
  {
    scope: 'workflows/versioned',
    dependencies: [
      ...common,
      'history',
      'context',
      'mutations',
      'workflows/shared',
      'workflows/deterministic',
      'workflows/history',
    ],
  },
];
function modules(directory: string): SourceModule[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? modules(path)
      : entry.name.endsWith('.ts')
        ? [{ path: relative(root, path).split(sep).join('/'), source: readFileSync(path, 'utf8') }]
        : [];
  });
}
it('keeps Context Memory on deliberate feature APIs with one-way dependencies', () => {
  const sources = modules(root);
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
  const paths = sources.map((source) => source.path);
  for (const boundary of boundaries)
    for (const entry of [...boundary.entries, ...(boundary.sharedEntries ?? [])])
      expect(paths).toContain(join(boundary.directory, entry).split(sep).join('/'));
});
it('keeps Context Memory source dependencies acyclic, including type-only edges', () => {
  expect(inspectSourceCycles(modules(root))).toEqual([]);
});
it('keeps independent Context Memory type modules erased at runtime', () => {
  expect(inspectTypeModules(modules(root))).toEqual([]);
});
it.each([
  ['mutations/publication.ts', '../document/index.js', true],
  ['budget/evaluation.ts', '../types/document.js', true],
  ['model-update/planner/types.ts', '../types/input.js', true],
  ['workflows/model-driven/create-definition.ts', '../shared/index.js', true],
  ['workflows/versioned/create-resources.ts', '../../history/index.js', true],
  ['mutations/publication.ts', '../document/items.js', false],
  ['workflows/model-driven/create-resources.ts', '../../model-update/planner/index.js', false],
  ['model-update/candidate.ts', './planner/create-planner.js', false],
  ['model-update/planner/create-planner.ts', '../candidate.js', false],
  ['budget/evaluation.ts', '../model-update/index.js', false],
  ['persistence/decision.ts', '../mutations/index.js', false],
  ['workflows/shared/create-definition.ts', '../deterministic/index.js', false],
  ['workflows/state/create-resources.ts', '../deterministic/index.js', false],
  ['context/read-context.ts', '../history/index.js', false],
  ['model-update/candidate.ts', '../workflows/index.js', false],
  ['document/items.ts', '../index.js', false],
] as const)('qualifies the boundary from %s to %s (allowed=%s)', (path, specifier, allowed) => {
  const sources = [{ path, source: "import type { Contract } from '" + specifier + "';" }];
  const violations = inspectSourceBoundaries(sources, boundaries, rules);
  if (allowed) expect(violations).toEqual([]);
  else expect(violations.length).toBeGreaterThan(0);
});
