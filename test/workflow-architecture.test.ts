import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../modules/workflow/packages/core/', import.meta.url));
const bundle = fileURLToPath(new URL('../modules/workflow/packages/bundle/', import.meta.url));
const qualification = fileURLToPath(
  new URL('../modules/workflow/tests/qualification/', import.meta.url)
);
const eslint = new ESLint();
const runtime = fileURLToPath(new URL('../modules/agent-base/packages/runtime/', import.meta.url));
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
    expect(source, file).not.toContain('@ta-agent/workflow-bundle');
  }
});

it('keeps independently qualified consumers on the public package entry', () => {
  for (const file of [
    ...sources(join(root, 'test')),
    ...sources(join(bundle, 'test')),
    ...sources(join(qualification, 'test')),
  ]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/(?:\.\.\/)+src\//);
    expect(source, file).not.toMatch(
      /(?:packages\/(?:core|bundle)|@ta-agent\/workflow-(?:core|bundle)\/)/
    );
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
  expect(manifest.devDependencies['@ta-agent/workflow-bundle']).toBe('workspace:*');
  expect(
    Object.keys(manifest.devDependencies).filter((name) => name.startsWith('@ta-agent/'))
  ).toEqual(['@ta-agent/workflow-bundle', '@ta-agent/workflow-core']);
});

it('keeps Bundle assembly on Core without product dependencies or another execution kernel', () => {
  const manifest = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  expect(manifest.dependencies).toEqual({ '@ta-agent/workflow-core': 'workspace:*' });
  expect(manifest.peerDependencies ?? {}).toEqual({});
  for (const file of [...sources(join(bundle, 'src')), ...sources(join(bundle, 'dist'))]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/@ta-agent\/(?:base|ui|self-learn|workbench)-/);
    expect(source, file).not.toMatch(/class Workflow\b|class ExecutionScope|class StepRuntime/);
    expect(source, file).not.toMatch(/@ta-agent\/workflow-core\//);
  }
  expect(readFileSync(join(bundle, 'src/workflow-bundle.ts'), 'utf8')).toContain('new Workflow');
});

it('keeps Agent execution on Core with only Agent-owned bindings and no duplicate kernel', () => {
  const manifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8')) as {
    name: string;
    dependencies: Record<string, string>;
  };
  expect(manifest.name).toBe('@ta-agent/base-runtime');
  expect(manifest.dependencies['@ta-agent/workflow-core']).toBe('workspace:*');
  expect(existsSync(join(runtime, '../workflow/package.json'))).toBe(false);
  const entry = readFileSync(join(runtime, 'src/index.ts'), 'utf8');
  expect(entry).not.toMatch(/from ['"]@ta-agent\/workflow-core/);
  expect(entry).toContain('bindAgentWorkflow');
  for (const file of sources(join(runtime, 'src'))) {
    expect(readFileSync(file, 'utf8'), file).not.toMatch(
      /class Workflow\b|createStepRunner|class ExecutionScope|class StepRuntime/
    );
  }
  for (const [feature, factory] of [
    ['request', 'workflow/create-request-workflow.ts'],
    ['session', 'navigation/workflow/create-workflow.ts'],
    ['session', 'compaction/workflow/create-workflow.ts'],
  ]) {
    const source = readFileSync(join(runtime, '..', feature!, 'src', factory!), 'utf8');
    expect(source).toContain("from '@ta-agent/workflow-core'");
    expect(source).toContain('new Workflow');
  }
});

it.each([
  '@ta-agent/base-domain',
  '@ta-agent/workbench-domain',
  '@ta-agent/self-learn-domain',
  '@ta-agent/ui-contracts',
  '@ta-agent/workflow-core/src/internal.js',
  '@ta-agent/workflow-bundle',
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

it.each([
  '@ta-agent/base-domain',
  '@ta-agent/workbench-domain',
  '@ta-agent/self-learn-domain',
  '@ta-agent/ui-contracts',
  '@ta-agent/workflow-core/src/internal.js',
])(
  'rejects %s from Bundle using the effective production ESLint configuration',
  async (specifier) => {
    const results = await eslint.lintText(`import '${specifier}';\n`, {
      filePath: join(bundle, 'src/index.ts'),
    });
    expect(results.flatMap((result) => result.messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
      ])
    );
  }
);

it('allows Bundle to consume Core through its public entry', async () => {
  const results = await eslint.lintText("import '@ta-agent/workflow-core';\n", {
    filePath: join(bundle, 'src/index.ts'),
  });
  expect(results.flatMap((result) => result.messages)).toEqual([]);
});

it('allows domain-independent imports using the effective production ESLint configuration', async () => {
  const results = await eslint.lintText("import 'node:crypto';\n", {
    filePath: join(root, 'src/index.ts'),
  });
  expect(results.flatMap((result) => result.messages)).toEqual([]);
});
