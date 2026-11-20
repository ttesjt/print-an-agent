import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import ts from 'typescript';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const eslint = new ESLint({ cwd: root });
const memoryRoot = join(root, 'modules/agent-memory');
const consumerRoot = join(memoryRoot, 'tests/qualification');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.name === 'node_modules') return [];
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}
function imports(path: string): string[] {
  const tree = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    )
      result.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return result;
}
function manifest(path: string) {
  return JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports?: unknown;
  };
}

it('keeps the independent consumer test-only, with only declared public dependencies', () => {
  const pkg = manifest(consumerRoot);
  expect(pkg.dependencies ?? {}).toEqual({});
  expect(pkg.exports).toBeUndefined();
  expect(pkg.devDependencies?.['@print-an-agent/context-memory']).toBe('workspace:*');
  expect(pkg.devDependencies?.['@print-an-agent/context-memory-sqlite']).toBe('workspace:*');
  for (const path of sources(consumerRoot)) {
    for (const specifier of imports(path)) {
      if (
        path === join(consumerRoot, 'vitest.config.ts') &&
        resolve(dirname(path), specifier) === join(root, 'vitest.config.base.js')
      )
        continue;
      if (specifier.startsWith('.'))
        expect(resolve(dirname(path), specifier).startsWith(`${consumerRoot}${sep}`), path).toBe(
          true
        );
      else if (!specifier.startsWith('node:')) {
        const packageName = specifier
          .split('/')
          .slice(0, specifier.startsWith('@') ? 2 : 1)
          .join('/');
        expect(pkg.devDependencies, `${path}: ${specifier}`).toHaveProperty(packageName);
        if (specifier.startsWith('@print-an-agent/')) expect(specifier, path).toBe(packageName);
      }
    }
  }
});

it('keeps domain/adapter runtime dependencies narrow and does not duplicate a Workflow kernel', () => {
  const domain = join(memoryRoot, 'packages/context-memory');
  const adapter = join(memoryRoot, 'packages/context-memory-sqlite');
  expect(Object.keys(manifest(domain).dependencies ?? {}).sort()).toEqual([
    '@print-an-agent/model-invocation-core',
    '@print-an-agent/workflow-core',
  ]);
  expect(manifest(adapter).dependencies).toEqual({
    '@print-an-agent/context-memory': 'workspace:*',
  });
  for (const path of [...sources(join(domain, 'src')), ...sources(join(adapter, 'src'))]) {
    expect(readFileSync(path, 'utf8'), path).not.toMatch(
      /class (?:Workflow|ExecutionScope|StepRuntime)\b|as unknown as/
    );
    for (const specifier of imports(path)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
        const packageName = specifier.split('/').slice(0, 2).join('/');
        expect(
          manifest(path.startsWith(`${domain}${sep}`) ? domain : adapter).dependencies,
          path
        ).toHaveProperty(packageName);
        expect(specifier, path).toBe(
          specifier === '@print-an-agent/workflow-core/bundle' ? specifier : packageName
        );
      }
    }
  }
});

it.each([
  '@print-an-agent/context-memory/src/index.js',
  '@print-an-agent/context-memory-sqlite/src/store.js',
  '@print-an-agent/base-runtime',
  '@print-an-agent/model-invocation-pi',
])(
  'rejects qualification consumer importing %s through the effective boundary',
  async (dependency) => {
    const result = await eslint.lintText(`import '${dependency}';\n`, {
      filePath: join(consumerRoot, 'test/public-consumer.test.ts'),
    });
    expect(
      result
        .flatMap((entry) => entry.messages)
        .some((entry) => entry.ruleId === 'no-restricted-imports')
    ).toBe(true);
  }
);
it.each([
  '@print-an-agent/base-runtime',
  '@print-an-agent/self-learn-domain',
  '@print-an-agent/workbench-application',
  '@print-an-agent/ui-contracts',
  '@print-an-agent/model-invocation-pi',
  '@print-an-agent/model-invocation-token-counters',
  '@print-an-agent/model-invocation-embedding-http',
  '@earendil-works/pi-ai',
  '@print-an-agent/context-memory-sqlite',
  '@print-an-agent/retrieval-memory',
  'node:sqlite',
])('rejects Context Memory importing %s through the real ESLint boundary', async (dependency) => {
  const results = await eslint.lintText(`import '${dependency}';\n`, {
    filePath: `${root}modules/agent-memory/packages/context-memory/src/index.ts`,
  });
  expect(
    results
      .flatMap((result) => result.messages)
      .some((message) => message.ruleId === 'no-restricted-imports')
  ).toBe(true);
});

it.each([
  '@print-an-agent/base-runtime',
  '@print-an-agent/self-learn-domain',
  '@print-an-agent/workbench-application',
])('rejects SQLite adapter importing %s through the real ESLint boundary', async (dependency) => {
  const results = await eslint.lintText(`import '${dependency}';\n`, {
    filePath: `${root}modules/agent-memory/packages/context-memory-sqlite/src/index.ts`,
  });
  expect(
    results
      .flatMap((result) => result.messages)
      .some((message) => message.ruleId === 'no-restricted-imports')
  ).toBe(true);
});

it.each([
  ['modules/workflow/packages/core/src/index.ts', '@print-an-agent/context-memory'],
  ['modules/workflow/packages/core/src/bundle/index.ts', '@print-an-agent/context-memory-sqlite'],
  ['modules/model-invocation/packages/core/src/index.ts', '@print-an-agent/context-memory'],
  ['modules/model-invocation/packages/pi/src/index.ts', '@print-an-agent/context-memory-sqlite'],
])('forbids reverse dependency from %s to %s', async (path, dependency) => {
  const results = await eslint.lintText(`import '${dependency}';\n`, {
    filePath: `${root}${path}`,
  });
  expect(
    results
      .flatMap((result) => result.messages)
      .some((message) => message.ruleId === 'no-restricted-imports')
  ).toBe(true);
});
