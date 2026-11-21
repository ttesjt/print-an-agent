import { inspectTypeModules } from '../tooling/architecture/type-modules.js';
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

const sourceRoot = fileURLToPath(
  new URL('../modules/agent-base/packages/agent-actor/src/', import.meta.url)
);
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: ['errors.ts', 'types.ts'] },
  { directory: 'actors', entries: ['index.ts'] },
  { directory: 'responsibilities', entries: ['index.ts'] },
];
const dependencies: readonly SourceDependencyRule[] = [
  { scope: 'actors', dependencies: ['errors.ts', 'types.ts'] },
  { scope: 'responsibilities', dependencies: ['actors', 'errors.ts', 'types.ts'] },
  { scope: 'actors/types', dependencies: [] },
  { scope: 'responsibilities/types', dependencies: ['actors'] },
  { scope: 'errors.ts', dependencies: ['types.ts'] },
  { scope: 'types.ts', dependencies: [] },
  {
    scope: 'responsibilities/definition.ts',
    dependencies: ['errors.ts', 'responsibilities/identifiers.ts', 'responsibilities/types'],
  },
  {
    scope: 'responsibilities/catalog.ts',
    dependencies: ['errors.ts', 'responsibilities/definition.ts', 'responsibilities/types'],
  },
  {
    scope: 'responsibilities/invocation.ts',
    dependencies: ['errors.ts', 'actors', 'responsibilities/types'],
  },
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
function inspect(path: string, source: string) {
  return inspectSourceBoundaries([{ path, source }], boundaries, dependencies);
}
it('keeps Agent Actor source on explicit feature entries and shared error contracts', () => {
  expect(inspectSourceBoundaries(sources(sourceRoot), boundaries, dependencies)).toEqual([]);
});
it('keeps the package root as its only npm entry and preserves dependency isolation', () => {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, '../package.json'), 'utf8')) as {
    exports: Record<string, { types: string; import: string }>;
    dependencies: Record<string, string>;
  };
  expect(manifest.exports).toEqual({
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  });
  expect(manifest.dependencies).toEqual({
    '@print-an-agent/model-invocation-core': 'workspace:*',
    '@print-an-agent/base-tool': 'workspace:*',
  });
});
it.each([
  ['responsibilities/routing.ts', "import { MAIN_ACTOR_ID } from '../actors/index.js';"],
  ['actors/definition.ts', "import { AgentActorError } from '../errors.js';"],
  [
    'responsibilities/types/routing.ts',
    "import type { ResolvedAgentActor } from '../../actors/index.js';",
  ],
])('allows the declared dependency from %s', (path, source) => {
  expect(inspect(path, source)).toEqual([]);
});
it.each([
  ['responsibilities/catalog.ts', "import './routing.js';", 'dependency'],
  ['responsibilities/definition.ts', "import './invocation.js';", 'dependency'],
  ['responsibilities/invocation.ts', "import './routing.js';", 'dependency'],
  [
    'responsibilities/routing.ts',
    "import { MAIN_ACTOR_ID } from '../actors/defaults.js';",
    'private-entry',
  ],
  [
    'actors/catalog.ts',
    "import type { ResponsibilityDefinition } from '../responsibilities/index.js';",
    'dependency',
  ],
  ['actors/definition.ts', "import { AgentActorError } from '../index.js';", 'ancestor-entry'],
  [
    'errors.ts',
    "import type { ResponsibilityDefinition } from './responsibilities/index.js';",
    'dependency',
  ],
  [
    'actors/types/definition.ts',
    "import { defineAgentActor } from '../definition.js';",
    'dependency',
  ],
  [
    'responsibilities/types/definition.ts',
    "import { defineResponsibility } from '../definition.js';",
    'dependency',
  ],
  ['index.ts', "export type * from './actors/index.js';", 'wildcard'],
])('rejects %s using %s', (path, source, rule) => {
  expect(inspect(path, source).some((violation) => violation.rule === rule)).toBe(true);
});

it('keeps owned type responsibility modules erased at runtime', () => {
  expect(inspectTypeModules(sources(sourceRoot))).toEqual([]);
});
