import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../modules/workflow/packages/core/', import.meta.url));
const bundle = join(root, 'src/bundle');
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
    expect(source, file).not.toMatch(/@print-an-agent\/(?:base|ui|self-learn|workbench)-/);
    expect(source, file).not.toMatch(/(?:agentRunContext|applyResult|applyTo|AgentIdentity)/);
    expect(source, file).not.toMatch(/(?:agent-base|agent-ui|self-learn-agent|model-workbench)\//);
  }
});

it('exports Core and Bundle from one dependency-free package', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    exports: Record<string, { types: string; import: string }>;
  };
  expect(manifest.exports).toEqual({
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './bundle': { types: './dist/bundle/index.d.ts', import: './dist/bundle/index.js' },
  });
  expect(existsSync(join(root, '../bundle/package.json'))).toBe(false);
  expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).not.toContain('./bundle');
});

it('keeps independently qualified consumers on the public package entry', () => {
  for (const file of [...sources(join(root, 'test')), ...sources(join(qualification, 'test'))]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/(?:\.\.\/)+src\//);
    expect(source, file).not.toMatch(
      /packages\/(?:core|bundle)\/|@print-an-agent\/workflow-core\/(?!bundle['"])/
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
  expect(manifest.devDependencies['@print-an-agent/workflow-core']).toBe('workspace:*');
  expect(
    Object.keys(manifest.devDependencies).filter((name) => name.startsWith('@print-an-agent/'))
  ).toEqual(['@print-an-agent/workflow-core']);
});

it('keeps Bundle assembly on Core without product dependencies or another execution kernel', () => {
  for (const file of [...sources(bundle), ...sources(join(root, 'dist/bundle'))]) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/@print-an-agent\/(?:base|ui|self-learn|workbench)-/);
    expect(source, file).not.toMatch(/class Workflow\b|class ExecutionScope|class StepRuntime/);
    expect(source, file).not.toContain('@print-an-agent/workflow-core');
    expect(source, file).not.toContain("from '../index.js'");
  }
  expect(readFileSync(join(bundle, 'workflow-bundle.ts'), 'utf8')).toContain('new Workflow');
});

it('keeps Agent execution on Core with only Agent-owned bindings and no duplicate kernel', () => {
  const manifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8')) as {
    name: string;
    dependencies: Record<string, string>;
  };
  expect(manifest.name).toBe('@print-an-agent/base-runtime');
  expect(manifest.dependencies['@print-an-agent/workflow-core']).toBe('workspace:*');
  expect(existsSync(join(runtime, '../workflow/package.json'))).toBe(false);
  const entry = readFileSync(join(runtime, 'src/index.ts'), 'utf8');
  expect(entry).not.toMatch(/from ['"]@print-an-agent\/workflow-core/);
  expect(entry).toContain('bindAgentWorkflow');
  for (const file of sources(join(runtime, 'src'))) {
    expect(readFileSync(file, 'utf8'), file).not.toMatch(
      /class Workflow\b|createStepRunner|class ExecutionScope|class StepRuntime/
    );
  }
  for (const [feature, factory] of [
    ['request', 'session-aware/workflow/create-workflow.ts'],
    ['session', 'navigation/workflow/create-workflow.ts'],
    ['session', 'compaction/workflow/create-workflow.ts'],
  ]) {
    const source = readFileSync(join(runtime, '..', feature!, 'src', factory!), 'utf8');
    expect(source).toContain("from '@print-an-agent/workflow-core'");
    expect(source).toContain('new Workflow');
  }
});

it.each([
  '@print-an-agent/base-domain',
  '@print-an-agent/workbench-domain',
  '@print-an-agent/self-learn-domain',
  '@print-an-agent/ui-contracts',
  '@print-an-agent/workflow-core/src/internal.js',
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
  '@print-an-agent/base-domain',
  '@print-an-agent/workbench-domain',
  '@print-an-agent/self-learn-domain',
  '@print-an-agent/ui-contracts',
  '@print-an-agent/workflow-core/src/internal.js',
])(
  'rejects %s from Bundle using the effective production ESLint configuration',
  async (specifier) => {
    const results = await eslint.lintText(`import '${specifier}';\n`, {
      filePath: join(bundle, 'index.ts'),
    });
    expect(results.flatMap((result) => result.messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
      ])
    );
  }
);

it('allows consumers to use the public Bundle subentry', async () => {
  const results = await eslint.lintText("import '@print-an-agent/workflow-core/bundle';\n", {
    filePath: join(runtime, 'src/index.ts'),
  });
  expect(results.flatMap((result) => result.messages)).toEqual([]);
});

it.each([
  ['workflow/workflow.ts', '@print-an-agent/workflow-core/bundle'],
  ['workflow/workflow.ts', '../bundle/index.js'],
  ['execution/step-runtime.ts', '../bundle/index.js'],
] as const)('rejects %s depending on Bundle through %s', async (file, specifier) => {
  const results = await eslint.lintText(`import '${specifier}';\n`, {
    filePath: join(root, 'src', file),
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

it.each(['request', 'session'])(
  'keeps %s contracts and emitted declarations independent of Agent runtime ownership',
  (feature) => {
    const directory = join(runtime, '..', feature);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const dependencies of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
    ]) {
      expect(dependencies ?? {}).not.toHaveProperty('@print-an-agent/base-runtime');
      expect(dependencies ?? {}).not.toHaveProperty('@print-an-agent/base-composition');
    }
    for (const file of [...sources(join(directory, 'src')), ...sources(join(directory, 'dist'))]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /@print-an-agent\/base-(?:runtime|composition)|BaseAgentRunContext|state\.agentRun/
      );
    }
  }
);

it.each(['request', 'session'])(
  'enforces %s Workflow ownership using the effective production lint rules',
  async (feature) => {
    const filePath = join(runtime, '..', feature, 'src/index.ts');
    for (const specifier of [
      '@print-an-agent/base-runtime',
      '@print-an-agent/base-composition',
      '@print-an-agent/base-composition/resource-registry',
    ]) {
      const result = await eslint.lintText(`export type * from '${specifier}';\n`, { filePath });
      expect(result.flatMap((entry) => entry.messages)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
        ])
      );
    }
    for (const specifier of [
      '@print-an-agent/workflow-core',
      '@print-an-agent/model-invocation-core',
      '@print-an-agent/base-actor',
    ]) {
      const result = await eslint.lintText(`import '${specifier}';\n`, { filePath });
      expect(
        result
          .flatMap((entry) => entry.messages)
          .filter((message) => message.ruleId === 'no-restricted-imports')
      ).toEqual([]);
    }
  }
);

it.each(['@print-an-agent/workflow-core', '@print-an-agent/workflow-core/bundle'])(
  'rejects source bypassing feature entries through its own package alias %s',
  async (specifier) => {
    for (const source of ['workflow/workflow.ts', 'bundle/workflow-bundle.ts']) {
      const results = await eslint.lintText(`import '${specifier}';\n`, {
        filePath: join(root, 'src', source),
      });
      expect(results.flatMap((result) => result.messages)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
        ])
      );
    }
  }
);
