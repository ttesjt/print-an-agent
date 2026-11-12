import { Workflow, WorkflowDefinitionError } from '@print-an-agent/workflow-core';
import { WorkflowBundle, WorkflowBundleDefinitionError } from '@print-an-agent/workflow-bundle';
import { expect, it, vi } from 'vitest';
import { readDefinition } from '../support/definitions.js';

const resources = { read: () => Promise.resolve('record') };
function construct(options: unknown): void {
  // Exercise the JavaScript boundary without pretending malformed data satisfies public types.
  Reflect.construct(WorkflowBundle, [options]);
}
function constructionFailure(options: unknown): unknown {
  try {
    construct(options);
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected construction to fail.');
}

const inherited: unknown = Object.create({ inherited: readDefinition() });

it.each([
  undefined,
  null,
  [],
  1,
  {},
  { workflows: {} },
  { resources },
  { resources, workflows: [] },
  { resources, workflows: { '': readDefinition() } },
  { resources, workflows: { [Symbol('member')]: readDefinition() } },
  { resources, workflows: inherited },
])('rejects malformed Bundle configuration without starting work: %j', (options) => {
  expect(() => construct(options)).toThrow(WorkflowBundleDefinitionError);
});

it.each([
  undefined,
  null,
  () => readDefinition(),
  { ...readDefinition(), createState: undefined },
  { ...readDefinition(), createResult: undefined },
  { ...readDefinition(), lifecycle: { onFinally: 'invalid' } },
  { ...readDefinition(), executeStep: 1 },
  new Workflow({ ...readDefinition(), resources }),
])('rejects incomplete definitions and preassembled Workflows: %j', (definition) => {
  expect(constructionFailure({ resources, workflows: { inspect: definition } })).toMatchObject({
    code: 'WORKFLOW_BUNDLE_MEMBER_INVALID',
    memberName: 'inspect',
  });
});

it('rejects a member binding, including undefined, without evaluating resource accessors', () => {
  const reads = vi.fn(() => resources);
  for (const binding of [resources, undefined]) {
    expect(
      constructionFailure({
        resources,
        workflows: {
          inspect: { ...readDefinition(), resources: binding },
        },
      })
    ).toMatchObject({ code: 'WORKFLOW_BUNDLE_RESOURCE_BINDING_FORBIDDEN' });
  }
  const definition = Object.defineProperty(readDefinition(), 'resources', { get: reads });
  expect(() => construct({ resources, workflows: { inspect: definition } })).toThrow(
    WorkflowBundleDefinitionError
  );
  expect(reads).not.toHaveBeenCalled();
});

it('rejects getters in options, member maps, definitions and hooks without invoking them', () => {
  const getter = vi.fn();
  const inspect = readDefinition();
  const cases: unknown[] = [
    {
      get resources() {
        getter();
        return resources;
      },
      workflows: { inspect },
    },
    {
      resources,
      workflows: {
        get inspect() {
          getter();
          return inspect;
        },
      },
    },
    {
      resources,
      workflows: {
        inspect: {
          ...inspect,
          get createState() {
            getter();
            return inspect.createState;
          },
        },
      },
    },
    {
      resources,
      workflows: {
        inspect: {
          ...inspect,
          lifecycle: {
            get onFinally() {
              getter();
              return () => undefined;
            },
          },
        },
      },
    },
  ];
  for (const options of cases)
    expect(() => construct(options)).toThrow(WorkflowBundleDefinitionError);
  expect(getter).not.toHaveBeenCalled();
});

it('preserves Core definition errors and borrows resources even when a later member fails assembly', () => {
  const close = vi.fn();
  const work = vi.fn(() => Promise.resolve());
  const inspect = readDefinition(work);
  const invalid = { ...readDefinition(), entryStep: 'missing' };
  expect(() =>
    construct({ resources: { ...resources, close }, workflows: { inspect, invalid } })
  ).toThrow(WorkflowDefinitionError);
  expect(work).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('permits an empty collection over explicitly bound resources', () => {
  const bundle = new WorkflowBundle({ resources: undefined, workflows: {} });
  expect(Object.keys(bundle.workflows)).toEqual([]);
  expect(Object.isFrozen(bundle.workflows)).toBe(true);
});
