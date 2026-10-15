import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../modules/workflow/packages/core/', import.meta.url));
const qualification = fileURLToPath(
  new URL('../modules/workflow/tests/qualification/', import.meta.url)
);
const eslint = new ESLint();
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(?:ts|js)$/.test(file) ? [file] : [];
  });
}

it('has no runtime dependencies on Agent, UI, persistence or product packages', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  expect(manifest.dependencies ?? {}).toEqual({});
  expect(manifest.peerDependencies ?? {}).toEqual({});
  for (const file of [...sources(join(root, 'src')), ...sources(join(root, 'dist'))]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/@ta-agent\/(?:base|ui|self-learn|workbench)-/);
    expect(source, file).not.toMatch(/(?:agentRunContext|applyResult|applyTo|AgentIdentity)/);
    expect(source, file).not.toMatch(/(?:agent-base|agent-ui|self-learn-agent|model-workbench)\//);
  }
});

it('keeps independently qualified consumers on the public package entry', () => {
  for (const file of [...sources(join(root, 'test')), ...sources(join(qualification, 'test'))]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/(?:\.\.\/)+src\//);
    expect(source, file).not.toMatch(/(?:packages\/core|@ta-agent\/workflow-core\/)/);
  }
});

it('keeps the second consumer test-only and linked to the official public package', () => {
  const manifest = JSON.parse(readFileSync(join(qualification, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies: Record<string, string>;
    exports?: unknown;
  };
  expect(manifest.dependencies ?? {}).toEqual({});
  expect(manifest.exports).toBeUndefined();
  expect(manifest.devDependencies['@ta-agent/workflow-core']).toBe('workspace:*');
  expect(
    Object.keys(manifest.devDependencies).filter((name) => name.startsWith('@ta-agent/'))
  ).toEqual(['@ta-agent/workflow-core']);
});

it.each([
  '@ta-agent/base-domain',
  '@ta-agent/workbench-domain',
  '@ta-agent/self-learn-domain',
  '@ta-agent/ui-contracts',
  '@ta-agent/workflow-core/src/internal.js',
])('rejects %s using the effective production ESLint configuration', async (specifier) => {
  const results = await eslint.lintText(`import '${specifier}';\n`, {
    filePath: join(root, 'src/index.ts'),
  });
  expect(results.flatMap((result) => result.messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    ])
  );
});

it('allows domain-independent imports using the effective production ESLint configuration', async () => {
  const results = await eslint.lintText("import 'node:crypto';\n", {
    filePath: join(root, 'src/index.ts'),
  });
  expect(results.flatMap((result) => result.messages)).toEqual([]);
});
