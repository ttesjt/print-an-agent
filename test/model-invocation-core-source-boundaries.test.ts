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
  new URL('../modules/model-invocation/packages/core/src/', import.meta.url)
);
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: ['timer-limits.ts'] },
  {
    directory: 'actor',
    entries: ['index.ts'],
    sharedEntries: [
      'errors.ts',
      'record-validation.ts',
      'types/invocation.ts',
      'invocation-policy.ts',
      'instructions.ts',
    ],
  },
  { directory: 'actor/capabilities', entries: ['index.ts'] },
  { directory: 'actor/invocation', entries: ['index.ts'] },
  {
    directory: 'model',
    entries: ['index.ts'],
    sharedEntries: ['errors.ts', 'record-validation.ts'],
  },
  { directory: 'model/provider', entries: ['index.ts'] },
  { directory: 'model/provenance', entries: ['index.ts'] },
  { directory: 'model/messages', entries: ['index.ts'] },
  { directory: 'model/events', entries: ['index.ts'] },
  { directory: 'embedding', entries: ['index.ts'] },
  {
    directory: 'token-measurement',
    entries: ['index.ts'],
    sharedEntries: [
      'counter.ts',
      'requirements.ts',
      'validation.ts',
      'errors.ts',
      'options.ts',
      'types/counter.ts',
      'types/input.ts',
    ],
  },
  { directory: 'token-measurement/text', entries: ['index.ts'] },
];
const dependencies: readonly SourceDependencyRule[] = [
  { scope: 'actor', dependencies: ['model', 'token-measurement', 'timer-limits.ts'] },
  {
    scope: 'actor/invocation',
    dependencies: [
      'actor/errors.ts',
      'actor/types/invocation.ts',
      'actor/invocation-policy.ts',
      'actor/instructions.ts',
      'actor/capabilities',
      'model',
    ],
  },
  { scope: 'actor/capabilities', dependencies: ['actor/errors.ts', 'actor/record-validation.ts'] },
  { scope: 'model', dependencies: ['timer-limits.ts'] },
  { scope: 'model/provider', dependencies: ['model/errors.ts', 'timer-limits.ts'] },
  {
    scope: 'model/provenance',
    dependencies: ['model/provider', 'model/errors.ts', 'model/record-validation.ts'],
  },
  {
    scope: 'model/messages',
    dependencies: ['model/provenance', 'model/errors.ts', 'model/record-validation.ts'],
  },
  {
    scope: 'model/events',
    dependencies: ['model/messages', 'model/errors.ts', 'model/record-validation.ts'],
  },
  { scope: 'embedding', dependencies: ['timer-limits.ts'] },
  { scope: 'token-measurement', dependencies: [] },
  {
    scope: 'token-measurement/text',
    dependencies: [
      'token-measurement/counter.ts',
      'token-measurement/requirements.ts',
      'token-measurement/validation.ts',
      'token-measurement/errors.ts',
      'token-measurement/options.ts',
      'token-measurement/types',
    ],
  },
  { scope: 'token-measurement/types', dependencies: ['token-measurement/options.ts'] },
  {
    scope: 'token-measurement/counter.ts',
    dependencies: [
      'token-measurement/types',
      'token-measurement/result.ts',
      'token-measurement/validation.ts',
      'token-measurement/errors.ts',
    ],
  },
  { scope: 'timer-limits.ts', dependencies: [] },
  {
    scope: 'actor/types/invocation.ts',
    dependencies: ['model', 'actor/identifiers.ts', 'actor/invocation-policy.ts'],
  },
  {
    scope: 'actor/types/engine.ts',
    dependencies: [
      'actor/types/invocation.ts',
      'actor/identifiers.ts',
      'actor/capabilities',
      'token-measurement',
    ],
  },
  { scope: 'actor/record-validation.ts', dependencies: ['actor/errors.ts'] },
  { scope: 'actor/invocation-policy.ts', dependencies: ['actor/errors.ts', 'timer-limits.ts'] },
  { scope: 'actor/identifiers.ts', dependencies: ['actor/errors.ts'] },
  { scope: 'actor/instructions.ts', dependencies: ['actor/errors.ts'] },
  { scope: 'model/errors.ts', dependencies: [] },
  { scope: 'model/record-validation.ts', dependencies: [] },
  { scope: 'token-measurement/options.ts', dependencies: [] },
  {
    scope: 'token-measurement/validation.ts',
    dependencies: ['token-measurement/options.ts', 'token-measurement/errors.ts'],
  },
  {
    scope: 'token-measurement/result.ts',
    dependencies: [
      'token-measurement/types',
      'token-measurement/validation.ts',
      'token-measurement/errors.ts',
    ],
  },
  {
    scope: 'token-measurement/requirements.ts',
    dependencies: [
      'token-measurement/types',
      'token-measurement/result.ts',
      'token-measurement/validation.ts',
      'token-measurement/errors.ts',
    ],
  },
  { scope: 'token-measurement/errors.ts', dependencies: [] },
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

it('keeps Core features on explicit entries with one-way dependencies', () => {
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

it('retains one npm entry and no production dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, '../package.json'), 'utf8')) as {
    exports: Record<string, { types: string; import: string }>;
    dependencies: Record<string, string>;
  };
  expect(manifest.exports).toEqual({
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  });
  expect(manifest.dependencies).toEqual({});
});

it.each([
  ['actor/engine.ts', "import type { ModelMessage } from '../model/index.js';"],
  ['actor/binding.ts', "import { bindTextTokenCounter } from '../token-measurement/index.js';"],
  [
    'actor/capabilities/validation.ts',
    "import { assertActorRecordKeys } from '../record-validation.js';",
  ],
  [
    'actor/invocation/completion.ts',
    "import type { ActorDirectRequest } from '../types/invocation.js';",
  ],
  ['model/messages/message.ts', "import '../provenance/index.js';"],
  ['token-measurement/text/counter-binding.ts', "import '../counter.js';"],
])('accepts the declared dependency in %s', (path, source) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, dependencies)).toEqual([]);
});
it.each([
  ['actor/engine.ts', "import '../model/types.js';", 'private-entry'],
  ['actor/engine.ts', "import '../embedding/index.js';", 'dependency'],
  ['model/types.ts', "import type { ActorEngine } from '../actor/index.js';", 'dependency'],
  ['embedding/input.ts', "import '../token-measurement/index.js';", 'dependency'],
  ['actor/engine.ts', "import '../index.js';", 'ancestor-entry'],
  ['index.ts', "export type * from './actor/index.js';", 'wildcard'],
  ['actor/binding.ts', "import './invocation/completion.js';", 'private-entry'],
  ['actor/invocation/completion.ts', "import '../binding.js';", 'ancestor-entry'],
  [
    'actor/types/invocation.ts',
    "import type { ActorDefinition } from './definition.js';",
    'dependency',
  ],
  ['actor/capabilities/narrowing.ts', "import '../binding.js';", 'dependency'],
  ['model/provenance/provenance.ts', "import '../provider/reference.js';", 'private-entry'],
  ['model/provider/reference.ts', "import '../messages/index.js';", 'dependency'],
  [
    'model/events/types.ts',
    "import type { ModelInteractionRuntime } from '../types/interaction-runtime.js';",
    'ancestor-entry',
  ],
  ['token-measurement/counter.ts', "import './text/index.js';", 'dependency'],
  [
    'token-measurement/types/counter.ts',
    "import type { TextTokenInput } from '../text/index.js';",
    'dependency',
  ],
  ['timer-limits.ts', "import './actor/index.js';", 'dependency'],
])('rejects the forbidden dependency in %s', (path, source, rule) => {
  expect(
    inspectSourceBoundaries([{ path, source }], boundaries, dependencies).some(
      (violation) => violation.rule === rule
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
  if (entry === undefined) throw new Error('Missing Core entry');
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(entry);
  if (symbol === undefined) throw new Error('Missing Core module symbol');
  expect(
    checker
      .getExportsOfModule(symbol)
      .map((value) => value.name)
      .sort()
  ).toEqual(inventory.names);
});
