import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import ts from 'typescript';
import {
  inspectSourceBoundaries,
  type SourceBoundary,
  type SourceDependencyRule,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';

const root = fileURLToPath(
  new URL('../modules/agent-base/packages/composition/src/', import.meta.url)
);
const foundation = ['management/namespace', 'management/authority', 'management/operation'];
const memoryShared = [
  'types/reference.ts',
  'types/provisioning.ts',
  'input.ts',
  'identity.ts',
  'errors.ts',
];
const sessionMemoryShared = ['journal.ts', 'errors.ts', 'failures.ts', 'types/workflows.ts'];
const features = [
  'management/definition',
  ...foundation,
  'management/agents',
  'management/runtime-materialization',
  'management/sessions',
  'management/sessions/management',
  'management/sessions/navigation',
  'management/memory/context',
  'management/memory/retrieval',
  'management/session-context-memory/mutations',
  'management/session-context-memory/navigation',
];
const boundaries: readonly SourceBoundary[] = [
  { directory: 'management', entries: ['index.ts'] },
  { directory: 'management/memory', entries: ['index.ts'], sharedEntries: memoryShared },
  {
    directory: 'management/session-context-memory',
    entries: ['index.ts'],
    sharedEntries: sessionMemoryShared,
  },
  ...features.map((directory) => ({ directory, entries: ['index.ts'] })),
];
const scope = (name: string) => `management/${name}`;
const dependencies: readonly SourceDependencyRule[] = [
  { scope: scope('operation'), dependencies: [] },
  { scope: scope('namespace'), dependencies: [scope('operation')] },
  { scope: scope('authority'), dependencies: [scope('namespace'), scope('operation')] },
  ...['agents', 'runtime-materialization', 'sessions'].map((name) => ({
    scope: scope(name),
    dependencies: foundation,
  })),
  {
    scope: scope('definition'),
    dependencies: ['agents', 'runtime-materialization', 'memory', 'sessions'].map(scope),
  },
  {
    scope: scope('services'),
    dependencies: [
      'definition',
      'agents',
      'runtime-materialization',
      'memory',
      'sessions',
      'session-context-memory',
      ...['namespace', 'authority', 'operation'],
    ].map(scope),
  },
  { scope: scope('memory'), dependencies: [scope('namespace')] },
  ...['context', 'retrieval'].map((name) => ({
    scope: scope(`memory/${name}`),
    dependencies: [scope('namespace'), ...memoryShared.map((file) => scope(`memory/${file}`))],
  })),
  { scope: scope('memory/types'), dependencies: [scope('namespace')] },
  { scope: scope('memory/errors.ts'), dependencies: [scope('memory/types/reference.ts')] },
  { scope: scope('memory/identity.ts'), dependencies: [] },
  {
    scope: scope('memory/input.ts'),
    dependencies: ['types', 'identity.ts', 'errors.ts'].map((name) => scope(`memory/${name}`)),
  },
  { scope: scope('session-context-memory'), dependencies: [scope('sessions'), scope('operation')] },
  ...['mutations', 'navigation'].map((name) => ({
    scope: scope(`session-context-memory/${name}`),
    dependencies: sessionMemoryShared.map((file) => scope(`session-context-memory/${file}`)),
  })),
  { scope: scope('session-context-memory/journal.ts'), dependencies: [] },
  { scope: scope('session-context-memory/failures.ts'), dependencies: [] },
  {
    scope: scope('session-context-memory/errors.ts'),
    dependencies: [scope('session-context-memory/failures.ts')],
  },
  {
    scope: scope('session-context-memory/types'),
    dependencies: [scope('session-context-memory/tools.ts')],
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
const sources = modules(root).filter((module) => module.path.startsWith('management/'));
it('declares every Composition management feature entry and shared ancestor module', () => {
  const paths = sources.map((module) => module.path);
  const entries = [
    ...new Set(
      boundaries.flatMap((boundary) =>
        boundary.entries.map((entry) => posix.join(boundary.directory, entry))
      )
    ),
  ];
  for (const boundary of boundaries)
    for (const entry of boundary.sharedEntries ?? [])
      expect(paths).toContain(posix.join(boundary.directory, entry));
  expect(paths.filter((file) => file.endsWith('index.ts')).sort()).toEqual(entries.sort());
});
it('keeps Composition management on explicit APIs and one-way dependency rules, including type references', () => {
  expect(inspectSourceBoundaries(sources, boundaries, dependencies)).toEqual([]);
});
it('accepts Definition composition through capability APIs', () => {
  expect(
    inspectSourceBoundaries(
      [
        {
          path: 'management/definition/example.ts',
          source: "import type { ContextMemoryManagementCapability } from '../memory/index.js';",
        },
      ],
      boundaries,
      dependencies
    )
  ).toEqual([]);
});
it.each([
  [
    'management/definition/example.ts',
    "import type { ContextMemoryManagementCapability } from '../memory/context/index.js';",
    'private-entry',
  ],
  [
    'management/authority/example.ts',
    "import type { ManagedAgentCompositionDefinition } from '../definition/index.js';",
    'dependency',
  ],
  [
    'management/memory/context/example.ts',
    "import type { ManagedAgentCompositionDefinition } from '../../definition/index.js';",
    'dependency',
  ],
  [
    'management/session-context-memory/mutations/example.ts',
    "import { createSessionContextMemory } from '../index.js';",
    'ancestor-entry',
  ],
] as const)('rejects invalid dependency at %s', (path, source, rule) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, dependencies)).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule })])
  );
});
it('keeps type responsibility modules erased at runtime', () => {
  for (const module of sources.filter((module) => /(^|\/)types(\/|\.ts$)/.test(module.path))) {
    const output = ts.transpileModule(module.source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        verbatimModuleSyntax: true,
        removeComments: true,
      },
    }).outputText;
    expect(output.replace(/export\s*\{\s*\};?/g, '').trim(), module.path).toBe('');
  }
});
