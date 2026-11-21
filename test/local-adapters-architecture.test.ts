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
  new URL('../modules/agent-base/packages/local-adapters/src/', import.meta.url)
);
const backends = ['identity', 'config', 'session', 'session-persistence'];
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'] },
  ...['identity', 'config', 'sqlite', 'observability'].map((directory) => ({
    directory,
    entries: ['index.ts'],
  })),
  { directory: 'session', entries: ['index.ts'], sharedEntries: ['limits.ts', 'types/ports.ts'] },
  { directory: 'session-persistence', entries: ['index.ts'], sharedEntries: ['types/ports.ts'] },
  ...backends.flatMap((feature) =>
    ['memory', 'sqlite'].map((backend) => ({
      directory: feature + '/' + backend,
      entries: ['index.ts'],
    }))
  ),
  { directory: 'request', entries: ['index.ts'] },
  { directory: 'request/output', entries: ['index.ts'] },
  {
    directory: 'request/journal',
    entries: ['index.ts'],
    sharedEntries: ['reference.ts', 'ownership.ts'],
  },
  ...['memory', 'sqlite'].map((backend) => ({
    directory: 'request/journal/' + backend,
    entries: ['index.ts'],
  })),
];
const rules: readonly SourceDependencyRule[] = [
  { scope: 'sqlite', dependencies: [] },
  { scope: 'observability', dependencies: [] },
  ...['identity', 'config'].flatMap((feature) => [
    { scope: feature, dependencies: ['sqlite'] },
    { scope: feature + '/memory', dependencies: [] },
    { scope: feature + '/sqlite', dependencies: ['sqlite'] },
  ]),
  { scope: 'session', dependencies: ['sqlite'] },
  { scope: 'session/memory', dependencies: ['session/limits.ts'] },
  { scope: 'session/sqlite', dependencies: ['sqlite', 'session/limits.ts'] },
  { scope: 'session/types', dependencies: [] },
  { scope: 'request', dependencies: ['sqlite', 'session/index.ts'] },
  { scope: 'request/output', dependencies: [] },
  { scope: 'request/journal/reference.ts', dependencies: [] },
  { scope: 'request/journal/ownership.ts', dependencies: [] },
  {
    scope: 'request/journal/memory',
    dependencies: ['request/journal/reference.ts', 'request/journal/ownership.ts'],
  },
  {
    scope: 'request/journal/sqlite',
    dependencies: [
      'sqlite',
      'session/index.ts',
      'request/journal/reference.ts',
      'request/journal/ownership.ts',
    ],
  },
  { scope: 'session-persistence', dependencies: ['session/index.ts', 'request/index.ts'] },
  ...['memory', 'sqlite'].map((backend) => ({
    scope: 'session-persistence/' + backend,
    dependencies: ['session/index.ts', 'request/index.ts', 'session-persistence/types/ports.ts'],
  })),
  { scope: 'session-persistence/types', dependencies: ['session/index.ts'] },
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
it('declares all local adapter feature entries and explicit ancestor contracts', () => {
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
it('keeps domain adapters, SQLite mechanics and coordinated persistence in their declared dependency layers', () => {
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
});
it('keeps all independent type modules erased at runtime', () => {
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
it('keeps all literal source dependencies acyclic, including type-only imports', () => {
  expect(inspectSourceCycles(sources)).toEqual([]);
});
it('accepts public composition, explicit ancestor contracts and local responsibility files', () => {
  expect(
    inspectSourceBoundaries(
      [
        {
          path: 'session-persistence/memory/example.ts',
          source:
            "import { MemorySessionAdapter, memorySessionCoordination } from '../../session/index.js';",
        },
        {
          path: 'request/journal/sqlite/example.ts',
          source: "import { normalizeJournalReference } from '../reference.js';",
        },
        {
          path: 'session/sqlite/example.ts',
          source: "import { MAX_PENDING_SESSION_MEMORY_RECORDS } from '../limits.js';",
        },
        {
          path: 'session/memory/example.ts',
          source: "import type { StoredMemorySession } from './types/state.js';",
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
    "export { SqliteSessionAdapter } from './session/sqlite/index.js';",
    'private-entry',
  ],
  [
    'session-persistence/memory/example.ts',
    "import { MemorySessionAdapter } from '../../session/memory/memory-session-adapter.js';",
    'private-entry',
  ],
  [
    'session/memory/example.ts',
    "import { createMemorySessionPersistence } from '../../session-persistence/index.js';",
    'dependency',
  ],
  [
    'request/journal/memory/example.ts',
    "import type { CoordinatedSessionPersistence } from '../../../session-persistence/index.js';",
    'dependency',
  ],
  [
    'session/memory/example.ts',
    "import { SqliteSessionAdapter } from '../sqlite/index.js';",
    'dependency',
  ],
  [
    'identity/sqlite/example.ts',
    "import { SqliteAgentConfigAdapter } from '../../config/index.js';",
    'dependency',
  ],
  [
    'sqlite/example.ts',
    "import type { SqliteSessionAdapterOptions } from '../session/index.js';",
    'dependency',
  ],
  [
    'request/output/example.ts',
    "import { MemoryRequestJournalAdapter } from '../journal/index.js';",
    'dependency',
  ],
  [
    'request/journal/memory/example.ts',
    "import { SqliteRequestJournalAdapter } from '../sqlite/index.js';",
    'dependency',
  ],
  [
    'request/journal/memory/example.ts',
    "import { MemoryRequestJournalAdapter } from '../index.js';",
    'ancestor-entry',
  ],
  [
    'session/sqlite/example.ts',
    "import { SqliteSessionAdapter } from './index.js';",
    'aggregate-import',
  ],
  [
    'session-persistence/types/example.ts',
    "import type { SqliteSessionPersistenceOptions } from '../sqlite/index.js';",
    'dependency',
  ],
  ['request/journal/index.ts', "export type * from './memory/types.js';", 'wildcard'],
] as const)('rejects invalid local adapter edge from %s', (path, source, rule) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, rules)).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule })])
  );
});
