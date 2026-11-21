import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  inspectSourceCycles,
  type SourceBoundary,
} from '../tooling/architecture/source-boundaries.js';

it('accepts an acyclic source graph with shared dependencies', () => {
  expect(
    inspectSourceCycles([
      { path: 'a.ts', source: "import type { B } from './b.js'; export { C } from './c.js';" },
      { path: 'b.ts', source: "type C = import('./c.js').C;" },
      { path: 'c.ts', source: 'export interface C {}' },
    ])
  ).toEqual([]);
});

it.each([
  "import type { B } from '../peer/b.js';",
  "export type { B } from '../peer/b.js';",
  "type B = import('../peer/b.js').B;",
  "void import('../peer/b.js');",
])('detects cycles through literal source edges: %s', (source) => {
  expect(
    inspectSourceCycles([
      { path: 'feature/a.ts', source },
      { path: 'peer/b.ts', source: "import type { A } from '../feature/a.js';" },
    ])
  ).toEqual([['feature/a.ts', 'peer/b.ts', 'feature/a.ts']]);
});

it('detects a self cycle', () => {
  expect(inspectSourceCycles([{ path: 'a.ts', source: "import './a.js';" }])).toEqual([
    ['a.ts', 'a.ts'],
  ]);
});

it('limits source cycles to supplied relative literal modules', () => {
  expect(
    inspectSourceCycles([
      {
        path: 'a.ts',
        source: `
      const target = './a.js';
      void import(target);
      import 'external';
      import '../outside.js';
      import './missing.js';
      const text = "import './a.js';";
    `,
      },
    ])
  ).toEqual([]);
});

const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts'], sharedEntries: ['contracts.ts'] },
  { directory: 'projects', entries: ['index.ts'], sharedEntries: ['contracts.ts'] },
  { directory: 'projects/editing', entries: ['index.ts'] },
  { directory: 'search', entries: ['index.ts'] },
];

function inspect(path: string, source: string) {
  return inspectSourceBoundaries([{ path, source }], boundaries);
}

it('accepts public peers, explicit shared ancestors and local responsibility files', () => {
  expect(inspect('search/query.ts', "import { projects } from '../projects/index.js';")).toEqual(
    []
  );
  expect(
    inspect('projects/editing/save.ts', "import type { Input } from '../contracts.js';")
  ).toEqual([]);
  expect(
    inspect('projects/editing/save.ts', "import { parse } from './parsing/parse.js';")
  ).toEqual([]);
});

it.each([
  "import { save } from '../projects/editing/save.js';",
  "export type { Input } from '../projects/editing/save.js';",
  "type Input = import('../projects/editing/save.js').Input;",
  "const editing = import('../projects/editing/save.js');",
])('rejects private implementation access in every supported literal import form: %s', (source) => {
  expect(inspect('search/query.ts', source)).toContainEqual({
    file: 'search/query.ts',
    target: 'projects/editing/save.ts',
    rule: 'private-entry',
  });
});

it('checks enclosing APIs even when a grandchild entry is public', () => {
  expect(
    inspect('search/query.ts', "import { save } from '../projects/editing/index.js';")
  ).toContainEqual({
    file: 'search/query.ts',
    target: 'projects/editing/index.ts',
    rule: 'private-entry',
  });
  const exposed = boundaries.map((b) =>
    b.directory === 'projects' ? { ...b, entries: [...b.entries, 'editing/index.ts'] } : b
  );
  expect(
    inspectSourceBoundaries(
      [{ path: 'search/query.ts', source: "import { save } from '../projects/editing/index.js';" }],
      exposed
    )
  ).toEqual([]);
});

it('rejects ancestor implementations and imports back through an owning aggregate', () => {
  expect(
    inspect('projects/editing/save.ts', "import { workflow } from '../workflow.js';")
  ).toContainEqual({
    file: 'projects/editing/save.ts',
    target: 'projects/workflow.ts',
    rule: 'ancestor-entry',
  });
  expect(inspect('projects/query.ts', "import { projects } from './index.js';")).toContainEqual({
    file: 'projects/query.ts',
    target: 'projects/index.ts',
    rule: 'aggregate-import',
  });
});

it('allows file entries without requiring responsibility-directory barrels', () => {
  expect(
    inspectSourceBoundaries(
      [{ path: 'query.ts', source: "import { parse } from './records/parse.js';" }],
      [{ directory: 'records', entries: ['parse.ts'] }]
    )
  ).toEqual([]);
});

it('checks dependency direction even through type-only public entries', () => {
  expect(
    inspectSourceBoundaries(
      [{ path: 'search/query.ts', source: "import type { Input } from '../projects/index.js';" }],
      boundaries,
      [{ scope: 'search', dependencies: ['contracts.ts'] }]
    )
  ).toContainEqual({ file: 'search/query.ts', target: 'projects/index.ts', rule: 'dependency' });
});

it.each(["export type * from './contracts.js';", "export * as contracts from './contracts.js';"])(
  'rejects wildcard exports while accepting deliberate named type exports: %s',
  (source) => {
    expect(inspect('projects/index.ts', source)).toContainEqual({
      file: 'projects/index.ts',
      target: source,
      rule: 'wildcard',
    });
    expect(inspect('projects/index.ts', "export type { Input } from './contracts.js';")).toEqual(
      []
    );
  }
);

it('accepts an acyclic graph with shared dependencies and ignores unsupplied/external/computed imports', () => {
  expect(
    inspectSourceCycles([
      {
        path: 'a.ts',
        source:
          "import type { B } from './b.js'; export { C } from './c.js'; import 'external'; import '../outside.js'; import './missing.js'; const path = './a.js'; void import(path);",
      },
      { path: 'b.ts', source: "type C = import('./c.js').C;" },
      { path: 'c.ts', source: 'export interface C {}' },
    ])
  ).toEqual([]);
});
it.each([
  "import type { B } from '../peer/b.js';",
  "export type { B } from '../peer/b.js';",
  "type B = import('../peer/b.js').B;",
  "void import('../peer/b.js');",
])('detects source cycles through supported literal edges: %s', (source) => {
  expect(
    inspectSourceCycles([
      { path: 'feature/a.ts', source },
      { path: 'peer/b.ts', source: "import type { A } from '../feature/a.js';" },
    ])
  ).toEqual([['feature/a.ts', 'peer/b.ts', 'feature/a.ts']]);
});
it('detects a self cycle', () => {
  expect(inspectSourceCycles([{ path: 'a.ts', source: "import './a.js';" }])).toEqual([
    ['a.ts', 'a.ts'],
  ]);
});
