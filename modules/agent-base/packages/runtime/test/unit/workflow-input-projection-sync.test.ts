import { runInNewContext } from 'node:vm';
import { RUN_WORKFLOW } from '@print-an-agent/workflow-core';
import { expect, it, vi } from 'vitest';
import { bindAgentWorkflow } from '../../src/index.js';
import { context, workflow, type Run } from '../support/workflow-binding.js';

const asynchronousProjections: readonly {
  label: string;
  projectInput: (run: Run) => unknown;
}[] = [
  { label: 'a resolved Promise', projectInput: () => Promise.resolve({ message: 'input' }) },
  {
    label: 'a rejecting async projection',
    projectInput: async () => {
      await Promise.resolve();
      throw new Error('projection rejected');
    },
  },
  { label: 'a pending Promise', projectInput: () => new Promise<never>(() => undefined) },
  {
    label: 'a rejected cross-realm Promise',
    projectInput: (): unknown => runInNewContext('Promise.reject(new Error("other realm"))'),
  },
];

it.each(asynchronousProjections)(
  'rejects $label before Workflow admission even with unknown input',
  async ({ projectInput }) => {
    const condition = vi.fn(() => RUN_WORKFLOW);
    const createState = vi.fn(() => ({}));
    const createResult = vi.fn(() => 'success');
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onFinally = vi.fn();
    const applyResult = vi.fn();
    const core = workflow<unknown>({
      condition,
      createState,
      createResult,
      lifecycle: { onSuccess, onError, onFinally },
    });
    const execute = vi.spyOn(core, 'run');
    const run: Run = { ...context(), output: 'existing' };
    const binding = bindAgentWorkflow({ workflow: core, projectInput, applyResult });

    await expect(binding.run(run)).rejects.toMatchObject({
      code: 'WORKFLOW_INPUT_PROJECTION_ASYNC',
      subjectName: 'test',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(condition).not.toHaveBeenCalled();
    expect(createState).not.toHaveBeenCalled();
    expect(createResult).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onFinally).not.toHaveBeenCalled();
    expect(applyResult).not.toHaveBeenCalled();
    expect(run.output).toBe('existing');
    // Give Node/Vitest a turn to report any Promise rejection left unobserved by the boundary.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
);

it('also rejects an async projection with object input without a type assertion', async () => {
  const binding = bindAgentWorkflow({
    workflow: workflow<object>(),
    projectInput: async (_run: Run) => {
      await Promise.resolve();
      throw new Error('object projection rejected');
    },
    applyResult: () => undefined,
  });
  await expect(binding.run(context())).rejects.toMatchObject({
    code: 'WORKFLOW_INPUT_PROJECTION_ASYNC',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
});

it('observes a native Promise rejection without accessing its overridden then', async () => {
  const rejection = Promise.reject(new Error('native rejection'));
  const then = vi.fn(() => {
    throw new Error('Do not access payload.then.');
  });
  void Object.defineProperty(rejection, 'then', { get: then });
  const binding = bindAgentWorkflow({
    workflow: workflow<unknown>(),
    projectInput: (_run: Run) => rejection,
    applyResult: () => undefined,
  });
  await expect(binding.run(context())).rejects.toMatchObject({
    code: 'WORKFLOW_INPUT_PROJECTION_ASYNC',
  });
  expect(then).not.toHaveBeenCalled();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

it.each(['object', 'function'] as const)(
  'rejects a %s thenable without calling then',
  async (kind) => {
    const then = vi.fn(() => {
      throw new Error('Do not run a custom thenable.');
    });
    const input = kind === 'object' ? { then } : Object.assign(() => undefined, { then });
    const core = workflow<unknown>();
    const execute = vi.spyOn(core, 'run');
    const binding = bindAgentWorkflow({
      workflow: core,
      projectInput: (_run: Run) => input,
      applyResult: () => undefined,
    });
    await expect(binding.run(context())).rejects.toMatchObject({
      code: 'WORKFLOW_INPUT_PROJECTION_ASYNC',
    });
    expect(then).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  }
);

it.each([null, 0, 'text', { then: 'business data' }, Object.assign(() => 1, { then: false })])(
  'preserves synchronous input %j',
  async (input) => {
    const condition = vi.fn(({ input: observed }: { input: unknown }) => {
      expect(observed).toBe(input);
      return RUN_WORKFLOW;
    });
    const binding = bindAgentWorkflow({
      workflow: workflow<unknown>({ condition }),
      projectInput: (_run: Run) => input,
      applyResult: () => undefined,
    });
    await expect(binding.run(context())).resolves.toMatchObject({ result: 'output' });
    expect(condition).toHaveBeenCalledOnce();
  }
);
