import { inspectTypeModules } from '../tooling/architecture/type-modules.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  type SourceBoundary,
  type SourceDependencyRule,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';
const root = fileURLToPath(new URL('../modules/agent-base/packages/runtime/src/', import.meta.url));
const shared = ['errors.ts', 'types/context.ts', 'types/invocation.ts'];
const features = ['agent', 'operations', 'runs', 'workflows'];
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: shared },
  ...features.map((directory) => ({ directory, entries: ['index.ts'] })),
];
const rules: readonly SourceDependencyRule[] = [
  { scope: 'errors.ts', dependencies: [] },
  { scope: 'types', dependencies: [] },
  { scope: 'workflows', dependencies: shared },
  { scope: 'operations', dependencies: [...shared, 'workflows'] },
  { scope: 'runs', dependencies: [...shared, 'operations', 'workflows'] },
  { scope: 'agent', dependencies: [...shared, 'operations', 'runs', 'workflows'] },
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
it('declares every Runtime feature entry and shared contract', () => {
  const paths = sources.map((module) => module.path);
  const entries = boundaries.flatMap((boundary) =>
    boundary.entries.map((entry) => posix.join(boundary.directory, entry))
  );
  for (const entry of shared) expect(paths).toContain(entry);
  expect(paths.filter((file) => file.endsWith('index.ts')).sort()).toEqual(entries.sort());
});
it('keeps Runtime feature dependencies and shared facts one-way, including types', () => {
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
});
it('accepts the Agent owner composing Run execution through its public entry', () => {
  expect(
    inspectSourceBoundaries(
      [
        {
          path: 'agent/example.ts',
          source: "import { executeAgentOperation } from '../runs/index.js';",
        },
      ],
      boundaries,
      rules
    )
  ).toEqual([]);
});
it.each([
  ['runs/example.ts', "import type { AgentDefinition } from '../agent/index.js';", 'dependency'],
  [
    'workflows/example.ts',
    "import type { AgentOperationDefinition } from '../operations/index.js';",
    'dependency',
  ],
  [
    'types/example.ts',
    "import type { AgentOperationDefinition } from '../operations/index.js';",
    'dependency',
  ],
  [
    'agent/example.ts',
    "import { executeAgentOperation } from '../runs/execute-operation.js';",
    'private-entry',
  ],
  ['runs/example.ts', "import type { AgentRunEnvironment } from './index.js';", 'aggregate-import'],
  ['operations/example.ts', "export type * from './types/definition.js';", 'wildcard'],
] as const)('rejects invalid Runtime dependency at %s', (path, source, rule) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, rules)).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule })])
  );
});
it('keeps type responsibility modules erased at runtime', () => {
  expect(inspectTypeModules(sources)).toEqual([]);
});
