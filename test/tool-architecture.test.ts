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

const root = fileURLToPath(new URL('../modules/agent-base/packages/tool/src/', import.meta.url));
const shared = ['errors.ts', 'types/errors.ts', 'types/identity.ts', 'types/handler.ts'];
const features = ['definition', 'registry', 'permissions', 'broker'];
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: shared },
  ...features.map((directory) => ({ directory, entries: ['index.ts'] })),
];
const rules: readonly SourceDependencyRule[] = [
  { scope: 'types', dependencies: [] },
  { scope: 'errors.ts', dependencies: ['types/errors.ts'] },
  { scope: 'definition', dependencies: shared },
  { scope: 'registry', dependencies: [...shared, 'definition'] },
  { scope: 'permissions', dependencies: [...shared, 'definition', 'registry'] },
  { scope: 'broker', dependencies: [...shared, 'definition', 'registry', 'permissions'] },
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

it('declares exactly the Tool feature entries and shared foundation', () => {
  const paths = sources.map((module) => module.path);
  const entries = boundaries.flatMap((boundary) =>
    boundary.entries.map((entry) => posix.join(boundary.directory, entry))
  );
  expect(paths.filter((file) => file.endsWith('index.ts')).sort()).toEqual(entries.sort());
  for (const file of shared) expect(paths).toContain(file);
});

it('keeps Tool dependencies on the declared APIs and direction, including types', () => {
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
});

it('keeps Tool source dependencies acyclic, including type-only edges', () => {
  expect(inspectSourceCycles(sources)).toEqual([]);
});

it('keeps independent Tool type modules erased at runtime', () => {
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

it('accepts Broker assembly through Registry and Permissions public contracts', () => {
  expect(
    inspectSourceBoundaries(
      [
        {
          path: 'broker/types/example.ts',
          source: `
      import type { ToolRegistry } from '../../registry/index.js';
      import type { ToolPermissionPolicy } from '../../permissions/index.js';
    `,
        },
      ],
      boundaries,
      rules
    )
  ).toEqual([]);
});

it.each([
  ['definition/example.ts', "import type { ToolRuntime } from '../broker/index.js';", 'dependency'],
  ['types/handler.ts', "import type { ToolRuntime } from '../broker/index.js';", 'dependency'],
  [
    'registry/example.ts',
    "import type { ToolDefinition } from '../definition/types.js';",
    'private-entry',
  ],
  ['broker/example.ts', "import type { ToolRegistry } from '../index.js';", 'ancestor-entry'],
  ['broker/example.ts', "import type { ToolRuntime } from './index.js';", 'aggregate-import'],
  [
    'permissions/example.ts',
    "import type { ToolRuntime } from '../broker/index.js';",
    'dependency',
  ],
  [
    'broker/example.ts',
    "import { resolveEffectiveTools } from '../permissions/policy.js';",
    'private-entry',
  ],
  ['index.ts', "export type * from './definition/types.js';", 'wildcard'],
] as const)('rejects invalid Tool edge at %s', (path, source, rule) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, rules)).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule })])
  );
});
