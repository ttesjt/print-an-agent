import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '@print-an-agent/workflow-core';
import {
  WorkflowBundle,
  WorkflowBundleDefinitionError,
  type BundleWorkflowDefinition,
  type BundleWorkflows,
  type WorkflowBundleDefinitionErrorCode,
  type WorkflowBundleOptions,
} from '@print-an-agent/workflow-core/bundle';
import * as bundleApi from '@print-an-agent/workflow-core/bundle';

interface Reader {
  read(key: string): Promise<string>;
}

const read: BundleWorkflowDefinition<
  'read',
  string,
  { key: string; value: string },
  Reader,
  string
> = {
  name: 'packed.read',
  entryStep: 'read',
  createState: ({ input }) => ({ key: input, value: '' }),
  createResult: ({ value }) => value,
  stepDefinitions: {
    read: {
      cardinality: 'at-most-once',
      skippable: false,
      step: async (context) => {
        context.state.value = await context.resources.read(context.state.key);
      },
    },
  },
};

test('the packed Bundle subentry binds ordinary Core Workflows with typed results', async () => {
  const resources: Reader = { read: (key) => Promise.resolve(`value:${key}`) };
  const definitions = { read };
  const options: WorkflowBundleOptions<Reader, typeof definitions> = {
    resources,
    workflows: definitions,
  };
  const bundle = new WorkflowBundle(options);
  const workflows: BundleWorkflows<typeof definitions> = bundle.workflows;
  const workflow: core.RunnableWorkflow<string, string> = workflows.read;
  assert.ok(workflow instanceof core.Workflow);
  assert.deepEqual(
    await Promise.all([workflow.run({ input: 'one' }), workflow.run({ input: 'two' })]),
    ['value:one', 'value:two']
  );
  assert.equal(
    await new core.Workflow({ ...read, resources }).run({ input: 'three' }),
    'value:three'
  );
});

test('the packed root and Bundle subentry expose distinct deliberate APIs', () => {
  assert.deepEqual(Object.keys(bundleApi).sort(), [
    'WorkflowBundle',
    'WorkflowBundleDefinitionError',
  ]);
  assert.equal(Object.hasOwn(core, 'WorkflowBundle'), false);
  assert.equal(Object.hasOwn(core, 'WorkflowBundleDefinitionError'), false);
  const code: WorkflowBundleDefinitionErrorCode = 'WORKFLOW_BUNDLE_DEFINITION_INVALID';
  const error = new WorkflowBundleDefinitionError(code, 'Invalid packed definition.');
  assert.equal(error.code, code);
});

test('the packed package rejects implementation paths', async () => {
  for (const specifier of [
    '@print-an-agent/workflow-core/src/index.js',
    '@print-an-agent/workflow-core/bundle/types',
    '@print-an-agent/workflow-core/dist/bundle/index.js',
  ]) {
    await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
});

// These declarations are checked against installed artifacts by both npm and pnpm consumers.
function checkTypeBoundaries(): void {
  // @ts-expect-error Bundle requires the Reader capability needed by its member.
  new WorkflowBundle({ resources: {}, workflows: { read } });
  // @ts-expect-error Bundle is available only from its public subentry.
  const fromRoot = core.WorkflowBundle;
  void fromRoot;
}
void checkTypeBoundaries;
