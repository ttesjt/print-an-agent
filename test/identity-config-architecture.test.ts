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
  { directory: 'identity', entries: ['index.ts'] },
  { directory: 'config', entries: ['index.ts'] },
];
const dependencies: readonly SourceDependencyRule[] = [
  { scope: 'identity', dependencies: [] },
  { scope: 'config', dependencies: ['identity'] },
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
    inspect('config/types/config.ts', "import type { AgentId } from '../../identity/index.js';")
  ).toEqual([]);
});
it.each([
  "import type { AgentId } from '../../identity/types/identity.js';",
  "type AgentId = import('../../identity/types/identity.js').AgentId;",
  "const identity = import('../../identity/lib/identity.js');",
  "export type { AgentId } from '../../identity/types/identity.js';",
])('rejects cross-feature implementation access: %s', (source) => {
  expect(
    inspect('config/types/config.ts', source).some(
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
    inspect('config/types/config.ts', "import type { AgentId } from '../../index.js';").some(
      (violation) => violation.rule === 'ancestor-entry'
    )
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
