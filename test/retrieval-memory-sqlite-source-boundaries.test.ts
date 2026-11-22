import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import ts from 'typescript';
import {
  inspectSourceBoundaries,
  inspectSourceCycles,
  sourceModuleSpecifiers,
  type SourceModule,
  type SourceBoundary,
  type SourceDependencyRule,
} from '../tooling/architecture/source-boundaries.js';
import { inspectTypeModules } from '../tooling/architecture/type-modules.js';

const root = fileURLToPath(
  new URL('../modules/agent-memory/packages/retrieval-memory-sqlite/src/', import.meta.url)
);
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: ['capabilities.ts', 'cancellation.ts'] },
  { directory: 'backend', entries: ['index.ts'] },
  { directory: 'worker', entries: ['index.ts'] },
  { directory: 'worker/protocol', entries: ['index.ts'] },
  {
    directory: 'database',
    entries: ['index.ts'],
    sharedEntries: ['types.ts', 'transaction.ts', 'vector-codec.ts', 'vector-index.ts'],
  },
  ...['persistence', 'publication', 'content', 'search'].map((name) => ({
    directory: `database/${name}`,
    entries: ['index.ts'],
  })),
];
const rules: readonly SourceDependencyRule[] = [
  { scope: 'capabilities.ts', dependencies: [] },
  { scope: 'cancellation.ts', dependencies: [] },
  { scope: 'backend', dependencies: ['worker', 'database/index.ts', 'capabilities.ts'] },
  { scope: 'worker', dependencies: ['database', 'cancellation.ts'] },
  { scope: 'worker/protocol', dependencies: ['database/index.ts'] },
  { scope: 'database', dependencies: ['capabilities.ts', 'cancellation.ts'] },
  { scope: 'database/persistence', dependencies: ['database/vector-codec.ts'] },
  {
    scope: 'database/publication',
    dependencies: [
      'database/persistence',
      'database/transaction.ts',
      'database/vector-index.ts',
      'database/vector-codec.ts',
    ],
  },
  {
    scope: 'database/content',
    dependencies: ['database/persistence', 'database/transaction.ts', 'capabilities.ts'],
  },
  {
    scope: 'database/search',
    dependencies: [
      'database/persistence',
      'database/transaction.ts',
      'database/vector-index.ts',
      'database/vector-codec.ts',
      'capabilities.ts',
    ],
  },
  ...['database/types.ts', 'database/vector-codec.ts'].map((scope) => ({
    scope,
    dependencies: [],
  })),
  { scope: 'database/transaction.ts', dependencies: ['cancellation.ts'] },
  { scope: 'database/vector-index.ts', dependencies: ['capabilities.ts'] },
];
// These apply after type erasure: host imports may mention Database's types, but must not load it.
const hostRules: readonly SourceDependencyRule[] = [
  { scope: 'index.ts', dependencies: ['backend/index.ts', 'capabilities.ts'] },
  { scope: 'backend', dependencies: ['worker/index.ts', 'capabilities.ts'] },
  { scope: 'worker/index.ts', dependencies: ['worker/create-client.ts'] },
  { scope: 'worker/create-client.ts', dependencies: ['worker/protocol/index.ts'] },
  { scope: 'worker/protocol', dependencies: [] },
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
function emitted(sources: readonly SourceModule[]): SourceModule[] {
  return sources.map((source) => ({
    path: source.path,
    source: ts.transpileModule(source.source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        verbatimModuleSyntax: true,
      },
    }).outputText,
  }));
}
function nativeHostImports(sources: readonly SourceModule[]): string[] {
  return sources
    .filter(
      (source) =>
        source.path === 'index.ts' ||
        source.path === 'capabilities.ts' ||
        source.path.startsWith('backend/') ||
        source.path === 'worker/index.ts' ||
        source.path === 'worker/create-client.ts' ||
        source.path.startsWith('worker/protocol/')
    )
    .flatMap((source) =>
      sourceModuleSpecifiers(
        ts.createSourceFile(source.path, source.source, ts.ScriptTarget.Latest, true)
      )
        .filter((specifier) => specifier === 'node:sqlite' || specifier === 'sqlite-vec')
        .map((specifier) => `${source.path}: ${specifier}`)
    );
}
it('keeps every enclosing SQLite feature on declared one-way APIs', () => {
  const sources = modules(root);
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
  const paths = sources.map((source) => source.path);
  for (const boundary of boundaries)
    for (const entry of [...boundary.entries, ...(boundary.sharedEntries ?? [])])
      expect(paths).toContain(join(boundary.directory, entry).split(sep).join('/'));
});
it('keeps literal source dependencies acyclic, including type-only edges', () => {
  expect(inspectSourceCycles(modules(root))).toEqual([]);
});
it('erases independent type modules at runtime', () => {
  expect(inspectTypeModules(modules(root))).toEqual([]);
});
it('keeps emitted host code independent of native database and worker bootstrap code', () => {
  const sources = emitted(modules(root));
  expect(inspectSourceBoundaries(sources, boundaries, hostRules)).toEqual([]);
  expect(nativeHostImports(sources)).toEqual([]);
});
it.each([
  ['backend/open-backend.ts', '../worker/index.js', true],
  ['backend/configuration.ts', '../database/index.js', true],
  ['worker/runtime.ts', '../database/index.js', true],
  ['worker/runtime.ts', './protocol/index.js', true],
  ['worker/protocol/types.ts', './operations.js', true],
  ['worker/protocol/messages.ts', '../../database/index.js', true],
  ['database/publication/write-decision.ts', '../persistence/index.js', true],
  ['database/publication/write-decision.ts', '../vector-index.js', true],
  ['database/persistence/entries.ts', '../vector-codec.js', true],
  ['database/search/search-entries.ts', '../../capabilities.js', true],
  ['database/transaction.ts', '../cancellation.js', true],
  ['backend/open-backend.ts', '../worker/create-client.js', false],
  ['index.ts', './worker/protocol/index.js', false],
  ['worker/runtime.ts', '../database/publication/index.js', false],
  ['worker/protocol/messages.ts', '../runtime.js', false],
  ['database/publication/publish.ts', '../persistence/receipts.js', false],
  ['database/content/read.ts', '../index.js', false],
  ['database/content/read.ts', '../connection.js', false],
  ['database/persistence/entries.ts', '../publication/index.js', false],
  ['database/vector-index.ts', './publication/index.js', false],
  ['database/types.ts', '../worker/protocol/index.js', false],
  ['database/connection.ts', '../worker/index.js', false],
  ['capabilities.ts', './database/index.js', false],
  ['cancellation.ts', './worker/index.js', false],
] as const)('qualifies %s importing %s (allowed=%s)', (path, specifier, allowed) => {
  const violations = inspectSourceBoundaries(
    [{ path, source: `import type { Contract } from '${specifier}';` }],
    boundaries,
    rules
  );
  if (allowed) expect(violations).toEqual([]);
  else expect(violations.length).toBeGreaterThan(0);
});
it.each([
  [
    'backend/configuration.ts',
    "import type { SqliteDatabaseConfiguration } from '../database/index.js';",
    true,
  ],
  ['backend/configuration.ts', "import { openDatabase } from '../database/index.js';", false],
  [
    'worker/create-client.ts',
    "import type { SqliteDatabaseConfiguration } from '../database/index.js';",
    true,
  ],
  ['worker/create-client.ts', "import { openDatabase } from '../database/index.js';", false],
  ['worker/create-client.ts', "import { runWorker } from './runtime.js';", false],
  ['worker/index.ts', "export { runWorker } from './runtime.js';", false],
  [
    'worker/protocol/messages.ts',
    "import type { SqliteDatabaseConfiguration } from '../../database/index.js';",
    true,
  ],
  ['worker/protocol/messages.ts', "import { openDatabase } from '../../database/index.js';", false],
  ['worker/protocol/messages.ts', "import 'node:sqlite';", false],
  ['backend/open-backend.ts', "import 'sqlite-vec';", false],
] as const)('qualifies host type erasure at %s (allowed=%s)', (path, source, allowed) => {
  const sources = emitted([{ path, source }]);
  const violations = [
    ...inspectSourceBoundaries(sources, boundaries, hostRules),
    ...nativeHostImports(sources),
  ];
  if (allowed) expect(violations).toEqual([]);
  else expect(violations.length).toBeGreaterThan(0);
});
