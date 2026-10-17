import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const eslint = new ESLint({ cwd: root });
it.each([
  '@ta-agent/base-runtime',
  '@ta-agent/self-learn-domain',
  '@ta-agent/workbench-application',
  '@ta-agent/ui-contracts',
  '@ta-agent/model-invocation-pi',
  '@earendil-works/pi-ai',
  '@ta-agent/context-memory-sqlite',
  '@ta-agent/retrieval-memory',
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
  '@ta-agent/base-runtime',
  '@ta-agent/self-learn-domain',
  '@ta-agent/workbench-application',
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
  ['modules/workflow/packages/core/src/index.ts', '@ta-agent/context-memory'],
  ['modules/workflow/packages/bundle/src/index.ts', '@ta-agent/context-memory-sqlite'],
  ['modules/model-invocation/packages/core/src/index.ts', '@ta-agent/context-memory'],
  ['modules/model-invocation/packages/pi/src/index.ts', '@ta-agent/context-memory-sqlite'],
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
