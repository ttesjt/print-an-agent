import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';
import ts from 'typescript';
const root = new URL('../', import.meta.url).pathname;
const path = join(root, 'modules/agent-memory/packages/retrieval-memory');
const eslint = new ESLint({ cwd: root });
const consumer = join(root, 'modules/agent-memory/tests/retrieval-memory-qualification');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) =>
    item.name === 'node_modules' || item.name === 'dist'
      ? []
      : item.isDirectory()
        ? sources(join(directory, item.name))
        : item.name.endsWith('.ts')
          ? [join(directory, item.name)]
          : []
  );
}
it.each([
  'node:sqlite',
  'sqlite-vec',
  '@print-an-agent/retrieval-memory-sqlite',
  '@print-an-agent/context-memory',
  '@print-an-agent/model-invocation-embedding-http',
  '@print-an-agent/base-runtime',
  '@print-an-agent/self-learn-domain',
  '@print-an-agent/workbench-application',
])('rejects domain import %s through the effective configuration', async (dependency) => {
  const result = await eslint.lintText(`import '${dependency}';`, {
    filePath: join(path, 'src/index.ts'),
  });
  expect(
    result
      .flatMap((item) => item.messages)
      .some((message) => message.ruleId === 'no-restricted-imports')
  ).toBe(true);
});
it('qualifies a test-only second consumer against package-root exports', () => {
  const pkg = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8')) as {
    dependencies?: object;
    exports?: object;
    devDependencies: Record<string, string>;
  };
  expect(pkg.dependencies).toBeUndefined();
  expect(pkg.exports).toBeUndefined();
  for (const file of sources(consumer)) {
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith('@print-an-agent/')
      ) {
        const specifier = node.moduleSpecifier.text;
        expect(specifier.split('/')).toHaveLength(2);
        expect(pkg.devDependencies).toHaveProperty(specifier);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
});
it.each([
  '@print-an-agent/retrieval-memory/src/index.js',
  '@print-an-agent/base-runtime',
  '@print-an-agent/self-learn-api',
  '@print-an-agent/workbench-application',
])('rejects independent consumer importing %s', async (dependency) => {
  const result = await eslint.lintText(`import '${dependency}';`, {
    filePath: join(consumer, 'test/backend-contract.test.ts'),
  });
  expect(
    result
      .flatMap((item) => item.messages)
      .some((message) => message.ruleId === 'no-restricted-imports')
  ).toBe(true);
});
it('keeps retrieval production files focused and independent from Context Memory', () => {
  const adapter = join(root, 'modules/agent-memory/packages/retrieval-memory-sqlite');
  for (const source of [...sources(join(path, 'src')), ...sources(join(adapter, 'src'))]) {
    const text = readFileSync(source, 'utf8');
    expect(text.trimEnd().split('\n').length, source).toBeLessThanOrEqual(200);
    expect(text).not.toMatch(/as unknown as|@print-an-agent\/context-memory/);
  }
});
it('keeps one native Workflow foundation and no unsafe type bridges', () => {
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((item) =>
      item.isDirectory() ? visit(join(directory, item.name)) : [join(directory, item.name)]
    );
  for (const source of visit(join(path, 'src')))
    expect(readFileSync(source, 'utf8')).not.toMatch(
      /as unknown as|class (?:Workflow|ExecutionScope|StepRuntime)\b/
    );
});
