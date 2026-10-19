import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const eslint = new ESLint({ cwd: root });

it.each([
  ['core', '@ta-agent/base-runtime'],
  ['core', '@ta-agent/workflow-core'],
  ['core', '@ta-agent/model-invocation-pi'],
  ['core', '@ta-agent/model-invocation-token-counters'],
  ['token-counters', '@ta-agent/base-runtime'],
  ['core', '@earendil-works/pi-ai'],
  ['core', 'typebox'],
  ['pi', '@ta-agent/base-tool'],
  ['pi', '@ta-agent/workbench-application'],
  ['pi', '@ta-agent/self-learn-domain'],
])(
  'rejects %s importing %s with the effective production ESLint configuration',
  async (owner, dependency) => {
    const results = await eslint.lintText(`import '${dependency}';\n`, {
      filePath: `${root}modules/model-invocation/packages/${owner}/src/index.ts`,
    });
    expect(
      results
        .flatMap((result) => result.messages)
        .some((message) => message.ruleId === 'no-restricted-imports')
    ).toBe(true);
  }
);

it('keeps Core dependency-free and provides no Agent Base compatibility packages', () => {
  const core: unknown = JSON.parse(
    readFileSync(
      new URL('../modules/model-invocation/packages/core/package.json', import.meta.url),
      'utf8'
    )
  );
  if (typeof core !== 'object' || core === null || !('dependencies' in core))
    throw new Error('Invalid Core manifest');
  expect(core.dependencies).toEqual({});
  expect(
    existsSync(new URL('../modules/agent-base/packages/model/package.json', import.meta.url))
  ).toBe(false);
  expect(
    existsSync(new URL('../modules/agent-base/packages/pi/package.json', import.meta.url))
  ).toBe(false);
});
