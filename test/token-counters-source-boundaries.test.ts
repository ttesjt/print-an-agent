import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  type SourceBoundary,
  type SourceDependencyRule,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';

const sourceRoot = fileURLToPath(
  new URL('../modules/model-invocation/packages/token-counters/src/', import.meta.url)
);
const boundaries: readonly SourceBoundary[] = [
  {
    directory: '',
    entries: ['index.ts'],
    sharedEntries: ['option-record.ts', 'character-estimator.ts'],
  },
  { directory: 'configuration', entries: ['index.ts'] },
  { directory: 'tiktoken', entries: ['index.ts'] },
];
const dependencies: readonly SourceDependencyRule[] = [
  {
    scope: 'configuration',
    dependencies: ['tiktoken', 'character-estimator.ts', 'option-record.ts'],
  },
  { scope: 'tiktoken', dependencies: ['option-record.ts'] },
  { scope: 'character-estimator.ts', dependencies: ['option-record.ts'] },
  { scope: 'option-record.ts', dependencies: [] },
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
it('keeps explicit feature/file entries and one-way dependencies', () => {
  const modules = sources(sourceRoot);
  expect(inspectSourceBoundaries(modules, boundaries, dependencies)).toEqual([]);
  for (const boundary of boundaries)
    for (const entry of [...boundary.entries, ...(boundary.sharedEntries ?? [])])
      expect(modules.map((module) => module.path)).toContain(join(boundary.directory, entry));
});
it.each([
  ['configuration/define.ts', "import '../option-record.js';"],
  ['configuration/resolve.ts', "import '../character-estimator.js';"],
  [
    'configuration/options.ts',
    "import type { TiktokenTextCounterOptions } from '../tiktoken/index.js';",
  ],
  ['tiktoken/counter.ts', "import '../option-record.js';"],
  ['index.ts', "export { createTiktokenTextCounter } from './tiktoken/index.js';"],
])('accepts a declared edge from %s', (path, source) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, dependencies)).toEqual([]);
});
it.each([
  ['configuration/define.ts', "import '../tiktoken/encoding.js';", 'private-entry'],
  [
    'index.ts',
    "export { defineTextTokenCounterConfig } from './configuration/define.js';",
    'private-entry',
  ],
  ['tiktoken/counter.ts', "import '../configuration/index.js';", 'dependency'],
  ['character-estimator.ts', "import './configuration/index.js';", 'dependency'],
  ['option-record.ts', "import './character-estimator.js';", 'dependency'],
  [
    'option-record.ts',
    "import type { TextTokenCounterConfig } from './configuration/index.js';",
    'dependency',
  ],
  ['tiktoken/counter.ts', "import '../character-estimator.js';", 'dependency'],
  ['configuration/define.ts', "import '../index.js';", 'ancestor-entry'],
  ['tiktoken/counter.ts', "import './index.js';", 'aggregate-import'],
  ['index.ts', "export type * from './configuration/index.js';", 'wildcard'],
])('rejects a forbidden edge from %s', (path, source, rule) => {
  expect(
    inspectSourceBoundaries([{ path, source }], boundaries, dependencies).some(
      (violation) => violation.rule === rule
    )
  ).toBe(true);
});
it('retains deliberate npm entries and pinned optional adapter dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, '../package.json'), 'utf8')) as {
    private: boolean;
    exports: unknown;
    dependencies: unknown;
  };
  expect(manifest.private).toBe(true);
  expect(manifest.exports).toEqual({
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  });
  expect(manifest.dependencies).toEqual({
    '@print-an-agent/model-invocation-core': 'workspace:*',
    'js-tiktoken': '1.0.21',
  });
});
it('retains all baseline public symbols', () => {
  const inventory = JSON.parse(
    readFileSync(join(sourceRoot, '../test/fixtures/public-api.json'), 'utf8')
  ) as { names: readonly string[] };
  const program = ts.createProgram([join(sourceRoot, 'index.ts')], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
  });
  const entry = program.getSourceFile(join(sourceRoot, 'index.ts'));
  if (entry === undefined) throw new Error('Missing token counter entry');
  const checker = program.getTypeChecker(),
    symbol = checker.getSymbolAtLocation(entry);
  if (symbol === undefined) throw new Error('Missing module symbol');
  expect(
    checker
      .getExportsOfModule(symbol)
      .map((value) => value.name)
      .sort()
  ).toEqual(inventory.names);
});
it('keeps SDK loading out of compiled configuration and encoding definitions', () => {
  for (const file of [
    'configuration/options.js',
    'configuration/define.js',
    'configuration/resolve.js',
    'tiktoken/encoding.js',
    'character-estimator.js',
    'option-record.js',
  ]) {
    const compiled = readFileSync(join(sourceRoot, '../dist', file), 'utf8');
    expect(
      ts
        .preProcessFile(compiled)
        .importedFiles.filter((entry) => entry.fileName.startsWith('js-tiktoken'))
    ).toEqual([]);
  }
});
it('keeps compiled public declarations on Core contracts and local encoding vocabulary', () => {
  const entry = join(sourceRoot, '../dist/index.d.ts');
  const program = ts.createProgram([entry], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: [],
  });
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  ).toEqual([]);
  expect(
    program
      .getSourceFiles()
      .map((file) => file.fileName)
      .filter((file) => file.includes('/js-tiktoken/'))
  ).toEqual([]);
});
