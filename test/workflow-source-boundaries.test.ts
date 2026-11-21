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

const sourceRoot = fileURLToPath(
  new URL('../modules/workflow/packages/core/src/', import.meta.url)
);
const boundaries: readonly SourceBoundary[] = [
  {
    directory: '',
    entries: ['index.ts', 'bundle/index.ts'],
  },
  { directory: 'contracts', entries: ['index.ts'] },
  { directory: 'steps', entries: ['index.ts'] },
  { directory: 'cancellation', entries: ['index.ts'] },
  { directory: 'execution', entries: ['index.ts'], sharedEntries: ['types.ts', 'failures.ts'] },
  { directory: 'execution/scope', entries: ['index.ts'] },
  { directory: 'execution/invocation', entries: ['index.ts'] },
  { directory: 'execution/observation', entries: ['index.ts'] },
  { directory: 'workflow', entries: ['index.ts'] },
  { directory: 'bundle', entries: ['index.ts'] },
];
const dependencyRules: readonly SourceDependencyRule[] = [
  { scope: 'contracts', dependencies: [] },
  { scope: 'workflow', dependencies: ['contracts', 'steps', 'execution'] },
  { scope: 'bundle', dependencies: ['workflow'] },
  { scope: 'steps', dependencies: ['contracts'] },
  { scope: 'cancellation', dependencies: [] },
  { scope: 'execution', dependencies: ['contracts', 'cancellation'] },
  {
    scope: 'execution/scope',
    dependencies: ['contracts', 'cancellation', 'execution/failures.ts'],
  },
  {
    scope: 'execution/invocation',
    dependencies: ['contracts', 'execution/scope', 'execution/types.ts', 'execution/failures.ts'],
  },
  { scope: 'execution/observation', dependencies: ['contracts'] },
  { scope: 'execution/types.ts', dependencies: [] },
  { scope: 'execution/failures.ts', dependencies: [] },
];
function readModules(directory: string): readonly SourceModule[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readModules(path);
    return entry.name.endsWith('.ts')
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
  return inspectSourceBoundaries([{ path, source }], boundaries, dependencyRules);
}

it('backs every declared Workflow entry with a source file', () => {
  const paths = readModules(sourceRoot).map((module) => module.path);
  const entries = boundaries.flatMap((boundary) =>
    [...boundary.entries, ...(boundary.sharedEntries ?? [])].map((entry) =>
      posix.join(boundary.directory, entry)
    )
  );
  for (const entry of entries) expect(paths, entry).toContain(entry);
  expect(paths.filter((path) => path.endsWith('index.ts')).sort()).toEqual(
    [...new Set(entries.filter((path) => path.endsWith('index.ts')))].sort()
  );
});
it('keeps Workflow source on declared public/shared entries and dependency directions', () => {
  expect(inspectSourceBoundaries(readModules(sourceRoot), boundaries, dependencyRules)).toEqual([]);
});
it('allows consumers to use the shared contract entry', () => {
  expect(
    inspect(
      'execution/step-runtime.ts',
      "import type { WorkflowContext } from '../contracts/index.js';"
    )
  ).toEqual([]);
});
it.each([
  "import { SKIP_STEP } from '../contracts/step-policy.js';",
  "export type { Step } from '../contracts/types/step.js';",
  "type Step = import('../contracts/types/step.js').Step<unknown>;",
  "const contracts = import('../contracts/types/step.js');",
])('rejects private shared contract access: %s', (source) => {
  expect(
    inspect('execution/step-runtime.ts', source).some(
      (violation) => violation.rule === 'private-entry'
    )
  ).toBe(true);
});
it('keeps the shared contracts independent of higher features', () => {
  expect(
    inspect('contracts/types/step.ts', "import type { Definition } from '../../bundle/index.js';")
  ).toContainEqual({
    file: 'contracts/types/step.ts',
    target: 'bundle/index.ts',
    rule: 'dependency',
  });
});

it('owns every production source within a declared feature', () => {
  const modules = readModules(sourceRoot);
  expect(
    modules.filter((module) => !module.path.includes('/')).map((module) => module.path)
  ).toEqual(['index.ts']);
  for (const module of modules.filter((module) => module.path !== 'index.ts')) {
    expect(
      boundaries.some(
        (boundary) => boundary.directory !== '' && module.path.startsWith(`${boundary.directory}/`)
      ),
      module.path
    ).toBe(true);
  }
});

it.each([
  ['bundle/types.ts', "import type { WorkflowDefinition } from '../workflow/index.js';"],
  ['workflow/definition.ts', "import { resolveStepRegistry } from '../steps/index.js';"],
  ['execution/invocation/context.ts', "import type { RunData } from '../types.js';"],
  [
    'execution/invocation/execute-invocation.ts',
    "import { ExecutionScope } from '../scope/index.js';",
  ],
  ['execution/step-runtime.ts', "import { createEventEmitter } from './observation/index.js';"],
] as const)('accepts the declared entry used by %s', (path, source) => {
  expect(inspect(path, source)).toEqual([]);
});

it.each([
  [
    'workflow/workflow.ts',
    "import { ExecutionScope } from '../execution/scope/index.js';",
    'private-entry',
  ],
  [
    'bundle/types.ts',
    "type Definition = import('../workflow/types/definition.js').WorkflowDefinition;",
    'private-entry',
  ],
  [
    'execution/invocation/context.ts',
    "import { StepRuntime } from '../step-runtime.js';",
    'ancestor-entry',
  ],
  [
    'execution/invocation/context.ts',
    "import { StepRuntime } from '../index.js';",
    'ancestor-entry',
  ],
  ['workflow/definition.ts', "import { Workflow } from '../index.js';", 'ancestor-entry'],
  ['execution/step-runtime.ts', "import { StepRuntime } from './index.js';", 'aggregate-import'],
  [
    'steps/sequential.ts',
    "import type { WorkflowEvent } from '../execution/index.js';",
    'dependency',
  ],
  [
    'cancellation/types.ts',
    "import type { WorkflowContext } from '../contracts/index.js';",
    'dependency',
  ],
  [
    'execution/observation/types.ts',
    "import type { WorkflowDefinition } from '../../workflow/index.js';",
    'dependency',
  ],
  [
    'execution/scope/scope.ts',
    "import { executeInvocation } from '../invocation/index.js';",
    'dependency',
  ],
  ['execution/step-runtime.ts', "export type * from '../contracts/index.js';", 'wildcard'],
] as const)('rejects %s using %s (%s)', (path, source, rule) => {
  expect(inspect(path, source).some((violation) => violation.rule === rule)).toBe(true);
});

it('keeps type responsibility modules erased at runtime', () => {
  expect(inspectTypeModules(readModules(sourceRoot))).toEqual([]);
});
