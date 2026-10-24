import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';
const root = new URL('../', import.meta.url).pathname;
const path = join(root, 'modules/agent-memory/packages/retrieval-memory');
const eslint = new ESLint({ cwd: root });
it.each([
  'node:sqlite',
  'sqlite-vec',
  '@ta-agent/retrieval-memory-sqlite',
  '@ta-agent/context-memory',
  '@ta-agent/model-invocation-embedding-http',
  '@ta-agent/base-runtime',
  '@ta-agent/self-learn-domain',
  '@ta-agent/workbench-application',
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
