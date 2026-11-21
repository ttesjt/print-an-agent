import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  inspectSourceCycles,
  sourceModuleSpecifiers,
  type SourceBoundary,
  type SourceDependencyRule,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';

const root = fileURLToPath(new URL('../modules/agent-base/packages/request/src/', import.meta.url));
const shared = ['errors.ts', 'types.ts', 'state-access.ts'];
const sessionlessShared = [
  'configuration.ts',
  'policy.ts',
  'resources.ts',
  'context.ts',
  'output.ts',
  'execution.ts',
  'lifecycle.ts',
  'names.ts',
  'step-definitions.ts',
  ...['input', 'output', 'policy', 'resources', 'state'].map((name) => `types/${name}.ts`),
];
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: shared },
  ...['policy', 'preparation', 'interaction', 'output'].map((directory) => ({
    directory,
    entries: ['index.ts'],
  })),
  { directory: 'session-aware', entries: ['index.ts'], sharedEntries: ['types/output.ts'] },
  { directory: 'session-aware/workflow', entries: ['index.ts'] },
  { directory: 'session-aware/replay', entries: ['index.ts'], sharedEntries: ['identifiers.ts'] },
  { directory: 'session-aware/replay/response-codec', entries: ['index.ts'] },
  { directory: 'sessionless', entries: ['index.ts'], sharedEntries: sessionlessShared },
  ...['generation', 'interaction'].map((name) => ({
    directory: `sessionless/${name}`,
    entries: ['index.ts'],
  })),
];
const commonDependencies = [...shared, 'policy', 'preparation', 'interaction', 'output'];
const rules: readonly SourceDependencyRule[] = [
  { scope: 'types.ts', dependencies: [] },
  { scope: 'errors.ts', dependencies: ['types.ts'] },
  { scope: 'state-access.ts', dependencies: ['errors.ts'] },
  ...['policy', 'preparation', 'interaction'].map((scope) => ({ scope, dependencies: shared })),
  { scope: 'output', dependencies: [...shared, 'interaction'] },
  { scope: 'session-aware', dependencies: commonDependencies },
  { scope: 'session-aware/workflow', dependencies: [...shared, 'interaction'] },
  { scope: 'session-aware/replay', dependencies: [...shared, 'session-aware/types/output.ts'] },
  {
    scope: 'session-aware/replay/response-codec',
    dependencies: [
      ...shared,
      'session-aware/types/output.ts',
      'session-aware/replay/identifiers.ts',
    ],
  },
  { scope: 'sessionless', dependencies: commonDependencies },
  { scope: 'sessionless/types', dependencies: ['interaction', 'output'] },
  ...['generation', 'interaction'].map((name) => ({
    scope: `sessionless/${name}`,
    dependencies: [
      ...commonDependencies,
      ...sessionlessShared.map((file) => `sessionless/${file}`),
    ],
  })),
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
function specifiers(source: string): readonly string[] {
  return sourceModuleSpecifiers(
    ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true)
  );
}
const graph = new Map(
  sources.map((module) => [
    module.path,
    specifiers(module.source)
      .filter((spec) => spec.startsWith('.'))
      .map((spec) =>
        posix.normalize(posix.join(posix.dirname(module.path), spec)).replace(/\.js$/u, '.ts')
      ),
  ])
);

it('declares exactly the Request feature entries and explicit ancestor contracts', () => {
  const paths = sources.map((module) => module.path);
  const entries = boundaries.flatMap((boundary) =>
    boundary.entries.map((entry) => posix.join(boundary.directory, entry))
  );
  expect(paths.filter((path) => path.endsWith('index.ts')).sort()).toEqual(entries.sort());
  for (const boundary of boundaries)
    for (const entry of boundary.sharedEntries ?? [])
      expect(paths).toContain(posix.join(boundary.directory, entry));
});
it('keeps Request capabilities and profiles on their declared APIs and one-way dependencies', () => {
  expect(inspectSourceBoundaries(sources, boundaries, rules)).toEqual([]);
});
it('keeps independent type modules erased at runtime', () => {
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
it('keeps the source module graph acyclic, including type-only dependencies', () => {
  expect(inspectSourceCycles(sources)).toEqual([]);
  for (const [file, targets] of graph)
    for (const target of targets) expect(graph.has(target), `${file}: ${target}`).toBe(true);
});
it('keeps the complete Sessionless implementation closure free of Session-aware authority', () => {
  const visited = new Set<string>();
  function visit(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    expect(file).not.toMatch(/^session-aware\//u);
    const source = sources.find((module) => module.path === file);
    if (source === undefined) throw new Error(`Missing Request source module: ${file}`);
    for (const spec of specifiers(source.source))
      expect(spec).not.toMatch(
        /^(?:@print-an-agent\/(?:base-(?:runtime|session|local-adapters|identity-config)|model-invocation-pi)(?:\/|$)|node:(?:fs|sqlite|crypto)(?:\/|$))/u
      );
    for (const target of graph.get(file) ?? []) visit(target);
  }
  for (const module of sources.filter((module) => module.path.startsWith('sessionless/')))
    visit(module.path);
});
it('accepts Journal decoding through its explicitly shared authoritative response contract', () => {
  expect(
    inspectSourceBoundaries(
      [
        {
          path: 'session-aware/replay/example.ts',
          source: "import type { AgentResponse } from '../types/output.js';",
        },
      ],
      boundaries,
      rules
    )
  ).toEqual([]);
});
it.each([
  [
    'interaction/example.ts',
    "import type { RequestWorkflowState } from '../session-aware/index.js';",
    'dependency',
  ],
  [
    'output/example.ts',
    "import type { RequestWorkflowState } from '../session-aware/types/workflow.js';",
    'private-entry',
  ],
  [
    'sessionless/generation/example.ts',
    "import { createInteractionWorkflow } from '../interaction/index.js';",
    'dependency',
  ],
  [
    'sessionless/generation/example.ts',
    "import type { SessionlessRequestInput } from '../index.js';",
    'ancestor-entry',
  ],
  [
    'sessionless/types/example.ts',
    "import type { SessionlessGenerationContext } from '../generation/index.js';",
    'dependency',
  ],
  [
    'session-aware/replay/example.ts',
    "import type { RequestWorkflowState } from '../types/workflow.js';",
    'ancestor-entry',
  ],
  [
    'session-aware/workflow/example.ts',
    "import { createDefaultRequestStepOverrides } from '../create-step-overrides.js';",
    'ancestor-entry',
  ],
  [
    'session-aware/replay/response-codec/example.ts',
    "import { parseRequestFingerprint } from '../index.js';",
    'ancestor-entry',
  ],
  [
    'example.ts',
    "import { createRequestWorkflow } from './session-aware/workflow/index.js';",
    'private-entry',
  ],
  ['interaction/example.ts', "export type * from './types.js';", 'wildcard'],
] as const)('rejects invalid Request edge from %s', (path, source, rule) => {
  expect(inspectSourceBoundaries([{ path, source }], boundaries, rules)).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule })])
  );
});
