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
import { inspectTypeModules } from '../tooling/architecture/type-modules.js';

const sourceRoot = fileURLToPath(
  new URL('../modules/model-invocation/packages/embedding-http/src/', import.meta.url)
);
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: ['authentication.ts'] },
  { directory: 'configuration', entries: ['index.ts'] },
  { directory: 'http', entries: ['index.ts'] },
];
const dependencies: readonly SourceDependencyRule[] = [
  { scope: 'configuration', dependencies: [] },
  { scope: 'authentication.ts', dependencies: [] },
  { scope: 'http', dependencies: ['configuration', 'authentication.ts'] },
  { scope: 'types.ts', dependencies: ['configuration'] },
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
it('keeps declared source entries, dependencies and pure type modules', () => {
  const modules = sources(sourceRoot);
  expect(inspectSourceBoundaries(modules, boundaries, dependencies)).toEqual([]);
  expect(inspectTypeModules(modules)).toEqual([]);
  for (const boundary of boundaries)
    for (const entry of [...boundary.entries, ...(boundary.sharedEntries ?? [])])
      expect(modules.map((module) => module.path)).toContain(join(boundary.directory, entry));
});
it.each([
  ['embedder.ts', "import './configuration/index.js';"],
  ['embedder.ts', "import './http/index.js';"],
  ['http/request.ts', "import '../authentication.js';"],
  ['types.ts', "import type { HttpTextEmbeddingConfig } from './configuration/index.js';"],
  ['http/protocol.ts', "import type { HttpTextEmbeddingConfig } from '../configuration/index.js';"],
  [
    'configuration/representation.ts',
    "import type { PreparedHttpEmbeddingConfig } from './types.js';",
  ],
])('accepts the explicit entry from %s', (path, source) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, dependencies)).toEqual([]);
});
it.each([
  ['embedder.ts', "import './configuration/prepare.js';", 'private-entry'],
  ['embedder.ts', "import './http/request.js';", 'private-entry'],
  ['http/request.ts', "import '../embedder.js';", 'ancestor-entry'],
  ['authentication.ts', "import './http/index.js';", 'dependency'],
  ['configuration/prepare.ts', "import '../http/index.js';", 'dependency'],
  ['http/request.ts', "import '../index.js';", 'ancestor-entry'],
  ['index.ts', "export type * from './configuration/index.js';", 'wildcard'],
  [
    'http/request.ts',
    "import type { PreparedHttpEmbeddingConfig } from '../configuration/types.js';",
    'private-entry',
  ],
  [
    'http/request.ts',
    "import type { CreateHttpTextEmbedderOptions } from '../types.js';",
    'ancestor-entry',
  ],
  ['configuration/prepare.ts', "import '../authentication.js';", 'dependency'],
  [
    'configuration/types.ts',
    "import type { CreateHttpTextEmbedderOptions } from '../types.js';",
    'dependency',
  ],
  ['types.ts', "import './http/index.js';", 'dependency'],
  [
    'authentication.ts',
    "import type { HttpEmbeddingTarget } from './configuration/index.js';",
    'dependency',
  ],
])('rejects a forbidden edge from %s', (path, source, rule) => {
  expect(
    inspectSourceBoundaries([{ path, source }], boundaries, dependencies).some(
      (violation) => violation.rule === rule
    )
  ).toBe(true);
});
it('retains the package export map and optional Core-only dependency', () => {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, '../package.json'), 'utf8')) as {
    private: boolean;
    exports: unknown;
    dependencies: unknown;
  };
  expect(manifest.private).toBe(true);
  expect(manifest.exports).toEqual({
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  });
  expect(manifest.dependencies).toEqual({ '@print-an-agent/model-invocation-core': 'workspace:*' });
});
it('retains the baseline public symbol inventory', () => {
  const inventory = JSON.parse(
    readFileSync(join(sourceRoot, '../test/fixtures/public-api.json'), 'utf8')
  ) as { names: readonly string[] };
  const program = ts.createProgram([join(sourceRoot, 'index.ts')], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
  });
  const entry = program.getSourceFile(join(sourceRoot, 'index.ts'));
  if (entry === undefined) throw new Error('Missing embedding HTTP entry');
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

it('keeps compiled HTTP execution independent of configuration runtime implementation', () => {
  for (const file of ['request.js', 'protocol.js', 'response-body.js']) {
    const compiled = readFileSync(join(sourceRoot, '../dist/http', file), 'utf8');
    expect(
      ts
        .preProcessFile(compiled)
        .importedFiles.map((entry) => entry.fileName)
        .filter((entry) => entry.includes('configuration'))
    ).toEqual([]);
  }
});

it('keeps public declarations on Core-facing contracts without exposing HTTP or authentication implementation', () => {
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
  const files = program.getSourceFiles().map((file) => file.fileName.split(sep).join('/'));
  expect(files).toContain(entry);
  expect(
    files.filter(
      (file) =>
        file.includes('/embedding-http/dist/http/') ||
        file.endsWith('/embedding-http/dist/authentication.d.ts')
    )
  ).toEqual([]);
});
