import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  inspectSourceCycles,
  type SourceBoundary,
  type SourceDependencyRule,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';

const root = fileURLToPath(
  new URL('../modules/agent-base/packages/standalone-agent/src/', import.meta.url)
);
const profiles = ['memory', 'directory', 'shared-sqlite'];
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: ['errors.ts', 'types.ts'] },
  ...[
    'configuration',
    'provider',
    'runtime',
    'setup',
    'bootstrap',
    'service-projections',
    'sqlite',
    'profiles',
    'agent-memory',
    ...profiles.map((profile) => `profiles/${profile}`),
  ].map((directory) => ({ directory, entries: ['index.ts'] })),
];
const profileDependencies = [
  'errors.ts',
  'configuration',
  'runtime',
  'setup',
  'sqlite',
  'service-projections',
  'agent-memory',
];
const rules: readonly SourceDependencyRule[] = [
  { scope: 'types.ts', dependencies: [] },
  { scope: 'errors.ts', dependencies: ['types.ts'] },
  { scope: 'configuration', dependencies: ['errors.ts'] },
  { scope: 'provider', dependencies: ['errors.ts', 'configuration'] },
  { scope: 'runtime', dependencies: ['errors.ts', 'configuration', 'provider'] },
  { scope: 'setup', dependencies: ['errors.ts', 'configuration', 'runtime'] },
  { scope: 'sqlite', dependencies: ['errors.ts', 'configuration', 'runtime'] },
  { scope: 'bootstrap', dependencies: ['configuration', 'runtime', 'setup'] },
  { scope: 'service-projections', dependencies: ['configuration', 'runtime'] },
  { scope: 'agent-memory', dependencies: ['errors.ts', 'setup'] },
  { scope: 'profiles', dependencies: profileDependencies },
  ...profiles.map((profile) => ({
    scope: `profiles/${profile}`,
    dependencies: profileDependencies,
  })),
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
const sources = modules(root);

it('declares exactly the Standalone feature APIs and explicitly shared ancestor contracts', () => {
  const paths = sources.map((module) => module.path);
  expect(paths.filter((path) => path.endsWith('index.ts')).sort()).toEqual(
    boundaries
      .flatMap((boundary) => boundary.entries.map((entry) => posix.join(boundary.directory, entry)))
      .sort()
  );
  for (const boundary of boundaries)
    for (const entry of boundary.sharedEntries ?? [])
      expect(paths).toContain(posix.join(boundary.directory, entry));
});
it('keeps profiles and shared capabilities on their named APIs and one-way dependency layers', () => {
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
});
it('keeps independent type and interface modules erased at runtime', () => {
  for (const module of sources.filter((module) => /(^|\/)types(\/|\.ts$)/u.test(module.path))) {
    const output = ts.transpileModule(module.source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        verbatimModuleSyntax: true,
        removeComments: true,
      },
    }).outputText;
    expect(output.replace(/export\s*\{\s*\};?/gu, '').trim(), module.path).toBe('');
  }
});
it('keeps the complete Standalone module graph acyclic, including type-only edges', () => {
  expect(inspectSourceCycles(sources)).toEqual([]);
});
it('accepts local provisioning responsibilities and shared capabilities through public entries', () => {
  expect(
    inspectSourceBoundaries(
      [
        {
          path: 'profiles/directory/create-definition.ts',
          source: "import { createStandaloneSqlitePortFactories } from '../../sqlite/index.js';",
        },
        {
          path: 'profiles/memory/resources/example.ts',
          source: "import type { MemoryProvisioningOptions } from '../types/provisioning.js';",
        },
        {
          path: 'agent-memory/context/example.ts',
          source: "import type { MemoryAllocationResolver } from '../types/allocation.js';",
        },
      ],
      boundaries,
      rules
    )
  ).toEqual([]);
});
it.each([
  [
    'index.ts',
    "export { createStandaloneMemorySetup } from './profiles/memory/index.js';",
    'private-entry',
  ],
  [
    'profiles/directory/example.ts',
    "import { createStandaloneMemorySetup } from '../memory/index.js';",
    'dependency',
  ],
  [
    'profiles/memory/resources/example.ts',
    "import { createStandaloneMemorySetup } from '../index.js';",
    'aggregate-import',
  ],
  [
    'provider/example.ts',
    "import { materializeStandaloneAgentRuntime } from '../runtime/index.js';",
    'dependency',
  ],
  [
    'configuration/example.ts',
    "import type { StandaloneRuntimeOptions } from '../runtime/index.js';",
    'dependency',
  ],
  [
    'sqlite/example.ts',
    "import type { SharedSqliteAgentResourceNamespace } from '../profiles/index.js';",
    'dependency',
  ],
  [
    'setup/example.ts',
    "import { withStandaloneMemoryManagement } from '../agent-memory/index.js';",
    'dependency',
  ],
  [
    'bootstrap/example.ts',
    "import { createStandaloneMemorySetup } from '../profiles/index.js';",
    'dependency',
  ],
  [
    'agent-memory/example.ts',
    "import { createStandaloneMemorySetup } from '../profiles/index.js';",
    'dependency',
  ],
  ['profiles/memory/index.ts', "export type * from './types/options.js';", 'wildcard'],
] as const)('rejects invalid Standalone dependency from %s', (path, source, rule) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, rules)).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule })])
  );
});
