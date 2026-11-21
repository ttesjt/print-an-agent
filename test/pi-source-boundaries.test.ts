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
import ts from 'typescript';
import { inspectTypeModules } from '../tooling/architecture/type-modules.js';

const sourceRoot = fileURLToPath(
  new URL('../modules/model-invocation/packages/pi/src/', import.meta.url)
);
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: ['types.ts'] },
  { directory: 'provider', entries: ['index.ts'] },
  { directory: 'faux', entries: ['index.ts'] },
  {
    directory: 'execution',
    entries: ['index.ts'],
    sharedEntries: ['types.ts', 'failures.ts', 'transport-liveness.ts'],
  },
  { directory: 'execution/interaction', entries: ['index.ts'] },
  { directory: 'translation', entries: ['index.ts'] },
];
const dependencies: readonly SourceDependencyRule[] = [
  { scope: 'provider', dependencies: ['execution'] },
  { scope: 'faux', dependencies: ['execution', 'translation', 'types.ts'] },
  { scope: 'execution', dependencies: ['translation', 'types.ts'] },
  { scope: 'translation', dependencies: [] },
  {
    scope: 'execution/interaction',
    dependencies: [
      'execution/types.ts',
      'execution/failures.ts',
      'execution/transport-liveness.ts',
      'translation',
    ],
  },
  { scope: 'execution/types.ts', dependencies: ['types.ts'] },
  { scope: 'execution/failures.ts', dependencies: [] },
  { scope: 'execution/transport-liveness.ts', dependencies: [] },
  { scope: 'types.ts', dependencies: [] },
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

it('keeps Pi features on explicit entries with one-way dependencies', () => {
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

it('retains one npm entry and pinned adapter dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, '../package.json'), 'utf8')) as {
    exports: Record<string, { types: string; import: string }>;
    dependencies: Record<string, string>;
  };
  expect(manifest.exports).toEqual({
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  });
  expect(manifest.dependencies).toEqual({
    '@earendil-works/pi-agent-core': '0.82.1',
    '@earendil-works/pi-ai': '0.82.1',
    '@print-an-agent/model-invocation-core': 'workspace:*',
    typebox: '1.1.38',
  });
});

it.each([
  ['provider/profile.ts', "import '../execution/index.js';"],
  ['faux/types.ts', "import type { PiInvocationKind } from '../types.js';"],
  ['execution/interaction/run.ts', "import '../failures.js';"],
  ['execution/interaction/run.ts', "import type { PiRuntimeHooks } from '../types.js';"],
  ['execution/interaction/run.ts', "import '../transport-liveness.js';"],
  ['execution/runtime.ts', "import './interaction/index.js';"],
  ['execution/interaction/events.ts', "import '../../translation/index.js';"],
])('accepts the declared dependency in %s', (path, source) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, dependencies)).toEqual([]);
});
it.each([
  ['provider/profile.ts', "import '../execution/runtime.js';", 'private-entry'],
  ['execution/runtime.ts', "import '../provider/index.js';", 'dependency'],
  ['provider/profile.ts', "import '../execution/interaction/index.js';", 'private-entry'],
  ['execution/interaction/run.ts', "import '../runtime.js';", 'ancestor-entry'],
  ['execution/interaction/run.ts', "import '../actor-engine.js';", 'dependency'],
  ['execution/runtime.ts', "import './interaction/events.js';", 'private-entry'],
  [
    'execution/types.ts',
    "import type { PiInteractionState } from './interaction/types.js';",
    'dependency',
  ],
  ['execution/failures.ts', "import './interaction/index.js';", 'dependency'],
  ['execution/transport-liveness.ts', "import './runtime.js';", 'dependency'],
  ['translation/messages.ts', "import '../execution/index.js';", 'dependency'],
  ['faux/snapshots.ts', "import '../translation/messages.js';", 'private-entry'],
  ['faux/profile.ts', "import '../provider/index.js';", 'dependency'],
  ['execution/runtime.ts', "import '../index.js';", 'ancestor-entry'],
  ['types.ts', "import type { PiFauxResponse } from './faux/index.js';", 'dependency'],
  ['index.ts', "export type * from './faux/index.js';", 'wildcard'],
])('rejects a forbidden dependency in %s', (path, source, rule) => {
  expect(
    inspectSourceBoundaries([{ path, source }], boundaries, dependencies).some(
      (value) => value.rule === rule
    )
  ).toBe(true);
});
it('retains the baseline public symbol inventory, including type-query-only exports', () => {
  const inventory = JSON.parse(
    readFileSync(join(sourceRoot, '../test/fixtures/public-api.json'), 'utf8')
  ) as { names: readonly string[] };
  const program = ts.createProgram([join(sourceRoot, 'index.ts')], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
  });
  const entry = program.getSourceFile(join(sourceRoot, 'index.ts'));
  if (entry === undefined) throw new Error('Missing Pi entry');
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(entry);
  if (symbol === undefined) throw new Error('Missing Pi module symbol');
  expect(
    checker
      .getExportsOfModule(symbol)
      .map((value) => value.name)
      .sort()
  ).toEqual(inventory.names);
});

it('keeps the reachable compiled public declarations independent of private SDK types', () => {
  const entry = join(sourceRoot, '../dist/index.d.ts');
  const program = ts.createProgram([entry], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    types: [],
  });
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  ).toEqual([]);
  const reachableFiles = program.getSourceFiles().map((file) => file.fileName.split(sep).join('/'));
  expect(reachableFiles).toContain(entry);
  expect(
    reachableFiles.filter(
      (path) =>
        path.includes('@earendil-works/') ||
        path.includes('/typebox/') ||
        path.includes('/pi/dist/execution/')
    )
  ).toEqual([]);
});
