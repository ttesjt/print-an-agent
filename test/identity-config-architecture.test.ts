import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';
import {
  inspectSourceBoundaries,
  type SourceBoundary,
  type SourceDependencyRule,
  type SourceModule,
} from '../tooling/architecture/source-boundaries.js';

const root = fileURLToPath(
  new URL('../modules/agent-base/packages/identity-config/', import.meta.url)
);
const sourceRoot = join(root, 'src');
const boundaries: readonly SourceBoundary[] = [
  { directory: '', entries: ['index.ts', 'identity/index.ts', 'config/index.ts'] },
  {
    directory: 'identity',
    entries: ['index.ts'],
    sharedEntries: ['values.ts', 'errors.ts', 'types/identity.ts'],
  },
  { directory: 'identity/catalog', entries: ['index.ts'] },
  { directory: 'config', entries: ['index.ts'] },
];
const dependencies: readonly SourceDependencyRule[] = [
  { scope: 'identity', dependencies: [] },
  { scope: 'identity/values.ts', dependencies: ['identity/errors.ts', 'identity/types'] },
  { scope: 'identity/errors.ts', dependencies: ['identity/types/errors.ts'] },
  { scope: 'identity/types', dependencies: [] },
  { scope: 'identity/catalog/types', dependencies: ['identity/types/identity.ts'] },
  {
    scope: 'identity/catalog/types/snapshot.ts',
    dependencies: ['identity/types/identity.ts'],
  },
  {
    scope: 'identity/catalog/types/ports.ts',
    dependencies: ['identity/types/identity.ts', 'identity/catalog/types/snapshot.ts'],
  },
  {
    scope: 'identity/catalog/snapshot.ts',
    dependencies: [
      'identity/values.ts',
      'identity/errors.ts',
      'identity/types/identity.ts',
      'identity/catalog/types/snapshot.ts',
    ],
  },
  { scope: 'config', dependencies: ['identity'] },
  { scope: 'config/types', dependencies: ['identity'] },
  { scope: 'config/types/codec.ts', dependencies: [] },
  { scope: 'config/types/errors.ts', dependencies: [] },
  { scope: 'config/types/snapshot.ts', dependencies: ['identity', 'config/types/codec.ts'] },
  {
    scope: 'config/types/adapter.ts',
    dependencies: ['identity', 'config/types/codec.ts', 'config/types/snapshot.ts'],
  },
  { scope: 'config/errors.ts', dependencies: ['config/types/errors.ts'] },
  { scope: 'config/value.ts', dependencies: ['config/types/codec.ts', 'config/errors.ts'] },
  {
    scope: 'config/codec.ts',
    dependencies: ['config/types/codec.ts', 'config/value.ts', 'config/errors.ts'],
  },
  {
    scope: 'config/snapshot.ts',
    dependencies: [
      'identity',
      'config/types/codec.ts',
      'config/types/snapshot.ts',
      'config/codec.ts',
      'config/value.ts',
      'config/errors.ts',
    ],
  },
];
const configRuntimeDependencies: readonly SourceDependencyRule[] = [
  { scope: 'config', dependencies: [] },
];

function sources(directory: string, base = sourceRoot, extension = '.ts'): readonly SourceModule[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path, base, extension)
      : entry.name.endsWith(extension)
        ? [
            {
              path: relative(base, path).split(sep).join('/'),
              source: readFileSync(path, 'utf8'),
            },
          ]
        : [];
  });
}
function inspect(path: string, source: string) {
  return inspectSourceBoundaries([{ path, source }], boundaries, dependencies);
}

it('replaces both packages with three explicit dependency-free entries', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    private: boolean;
    exports: Record<string, { types: string; import: string }>;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  expect(manifest.name).toBe('@print-an-agent/base-identity-config');
  expect(manifest.private).toBe(false);
  for (const group of [
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ])
    expect(group ?? {}).toEqual({});
  expect(manifest.exports).toEqual({
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './identity': { types: './dist/identity/index.d.ts', import: './dist/identity/index.js' },
    './config': { types: './dist/config/index.d.ts', import: './dist/config/index.js' },
  });
  for (const entry of Object.values(manifest.exports)) {
    expect(existsSync(join(root, entry.types))).toBe(true);
    expect(existsSync(join(root, entry.import))).toBe(true);
  }
  for (const old of ['identity', 'config'])
    expect(existsSync(join(root, '..', old, 'package.json'))).toBe(false);
});

it('keeps all production sources on the feature entries and Identity independent', () => {
  expect(inspectSourceBoundaries(sources(sourceRoot), boundaries, dependencies)).toEqual([]);
});
it('allows Config to consume the authoritative Identity contract', () => {
  expect(
    inspect('config/types/options.ts', "import type { AgentId } from '../../identity/index.js';")
  ).toEqual([]);
});
it('erases the Config dependency on Identity from compiled JavaScript', () => {
  const modules = sources(join(root, 'dist/config'), join(root, 'dist'), '.js');
  expect(modules.length).toBeGreaterThan(0);
  expect(inspectSourceBoundaries(modules, [], configRuntimeDependencies)).toEqual([]);
});
it('rejects a runtime Identity import under the compiled Config dependency rule', () => {
  expect(
    inspectSourceBoundaries(
      [{ path: 'config/snapshot.js', source: "import '../identity/index.js';" }],
      [],
      configRuntimeDependencies
    )
  ).toContainEqual({
    file: 'config/snapshot.js',
    target: 'identity/index.ts',
    rule: 'dependency',
  });
});
it.each([
  "import type { AgentId } from '../../identity/types/identity.js';",
  "type AgentId = import('../../identity/types/identity.js').AgentId;",
  "const identity = import('../../identity/values.js');",
  "export type { AgentId } from '../../identity/types/identity.js';",
])('rejects cross-feature implementation access: %s', (source) => {
  expect(
    inspect('config/types/options.ts', source).some(
      (violation) => violation.rule === 'private-entry'
    )
  ).toBe(true);
});
it('rejects Identity depending back on Config, including types', () => {
  expect(
    inspect(
      'identity/types/identity.ts',
      "import type { ConfigValue } from '../../config/index.js';"
    )
  ).toContainEqual({
    file: 'identity/types/identity.ts',
    target: 'config/index.ts',
    rule: 'dependency',
  });
});
it('rejects feature imports through the package aggregate', () => {
  expect(
    inspect('config/types/options.ts', "import type { AgentId } from '../../index.js';").some(
      (violation) => violation.rule === 'ancestor-entry'
    )
  ).toBe(true);
});

it.each([
  "import { defineAgentIdentity } from '../values.js';",
  "import { AgentIdentityError } from '../errors.js';",
  "import type { AgentId } from '../types/identity.js';",
])('allows Catalog to consume its shared Identity foundation: %s', (source) => {
  expect(inspect('identity/catalog/snapshot.ts', source)).toEqual([]);
});
it('rejects Catalog consuming the enclosing Identity aggregate', () => {
  expect(
    inspect('identity/catalog/snapshot.ts', "import { parseAgentId } from '../index.js';")
  ).toContainEqual({
    file: 'identity/catalog/snapshot.ts',
    target: 'identity/index.ts',
    rule: 'ancestor-entry',
  });
});
it.each([
  ['identity/index.ts', './catalog/types/snapshot.js'],
  ['config/types/options.ts', '../../identity/catalog/index.js'],
])('rejects entering Catalog through a private enclosing path from %s', (path, specifier) => {
  expect(
    inspect(path, `export type { AgentIdentitySnapshot } from '${specifier}';`).some(
      (violation) => violation.rule === 'private-entry'
    )
  ).toBe(true);
});
it.each(['identity/values.ts', 'identity/types/identity.ts', 'identity/errors.ts'])(
  'rejects the Identity foundation depending on Catalog from %s',
  (path) => {
    const specifier = path.includes('/types/') ? '../catalog/index.js' : './catalog/index.js';
    expect(
      inspect(path, `import type { AgentIdentitySnapshot } from '${specifier}';`).some(
        (violation) => violation.rule === 'dependency'
      )
    ).toBe(true);
  }
);

it.each([
  ['identity/catalog/types/snapshot.ts', './options.js'],
  ['identity/catalog/types/ports.ts', './options.js'],
  ['identity/catalog/snapshot.ts', './queries.js'],
])('rejects a reverse Catalog dependency from %s to %s', (path, specifier) => {
  expect(
    inspect(path, `import '${specifier}';`).some((violation) => violation.rule === 'dependency')
  ).toBe(true);
});

it.each([
  ['config/types/codec.ts', './adapter.js'],
  ['config/types/snapshot.ts', './options.js'],
  ['config/types/adapter.ts', './options.js'],
  ['config/value.ts', './codec.js'],
  ['config/codec.ts', './snapshot.js'],
  ['config/snapshot.ts', './agent-config.js'],
])('rejects a reverse Config dependency from %s to %s', (path, specifier) => {
  expect(
    inspect(path, `import '${specifier}';`).some((violation) => violation.rule === 'dependency')
  ).toBe(true);
});

const eslint = new ESLint();
it.each([
  '@print-an-agent/base-local-adapters',
  '@print-an-agent/base-composition/resource-registry',
  '@print-an-agent/base-runtime',
  '@print-an-agent/workflow-core',
  '@print-an-agent/model-invocation-core',
  '@print-an-agent/base-identity-config/identity',
  'node:fs/promises',
  'node:sqlite',
])('rejects concrete integration or package-alias dependency %s', async (specifier) => {
  const results = await eslint.lintText(`import '${specifier}';\n`, {
    filePath: join(sourceRoot, 'config/index.ts'),
  });
  expect(results.flatMap((result) => result.messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    ])
  );
});
