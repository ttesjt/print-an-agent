import { Workflow, type WorkflowEvent } from '@print-an-agent/workflow-core';
import { WorkflowBundle } from '@print-an-agent/workflow-bundle';
import { expect, it, vi } from 'vitest';
import {
  readDefinition,
  writeDefinition,
  type ReadPorts,
  type WritePorts,
} from '../support/definitions.js';

class Store implements WritePorts {
  readonly values = new Map<string, string>();
  close = vi.fn();
  read(id: string): Promise<string> {
    return Promise.resolve(this.values.get(id) ?? 'missing');
  }
  write(id: string, value: string): Promise<void> {
    this.values.set(id, value);
    return Promise.resolve();
  }
}

it('assembles real Core Workflows once with the exact shared adapter instance and distinct results', async () => {
  const store = new Store();
  const seen: ReadPorts[] = [];
  const inspect = readDefinition(async (c) => {
    seen.push(c.resources);
    c.result = await c.resources.read(c.input.id, c.signal);
  });
  const update = writeDefinition(async (c) => {
    seen.push(c.resources);
    await c.resources.write(c.input.id, c.input.value, c.signal);
    c.result = c.input.value.length;
  });
  const bundle = new WorkflowBundle({ resources: store, workflows: { update, inspect } });
  expect(store.values.size).toBe(0);
  expect(seen).toEqual([]);
  expect(bundle.workflows.inspect).toBeInstanceOf(Workflow);
  expect(bundle.workflows.update).toBeInstanceOf(Workflow);
  const member = bundle.workflows.inspect;
  await expect(bundle.workflows.update.run({ input: { id: 'one', value: 'hello' } })).resolves.toBe(
    5
  );
  await expect(bundle.workflows.inspect.run({ input: { id: 'one' } })).resolves.toBe('hello');
  await expect(member.run({ input: { id: 'one' } })).resolves.toBe('hello');
  expect(bundle.workflows.inspect).toBe(member);
  expect(seen).toHaveLength(3);
  expect(seen.every((ports) => ports === store)).toBe(true);
  expect(Object.isFrozen(store)).toBe(false);
  expect(store.close).not.toHaveBeenCalled();
});

it('snapshots definitions, overrides and member keys without freezing the caller configuration', async () => {
  const store = new Store();
  store.values.set('one', 'original');
  const overrides = {
    validate: () => Promise.resolve(),
  };
  const original = { ...readDefinition(), stepOverrides: overrides };
  const members = { inspect: original };
  const options = { resources: store, workflows: members };
  const bundle = new WorkflowBundle(options);
  options.resources = new Store();
  members.inspect = { ...original, name: 'replaced' };
  original.name = 'also-replaced';
  overrides.validate = () => Promise.reject(new Error('late override'));
  await expect(bundle.workflows.inspect.run({ input: { id: 'one' } })).resolves.toBe('original');
  expect(bundle.workflows.inspect.name).toBe('records.inspect');
  expect(Object.keys(bundle.workflows)).toEqual(['inspect']);
  expect(Object.getPrototypeOf(bundle.workflows)).toBeNull();
  expect(Object.isFrozen(bundle.workflows)).toBe(true);
  expect(Reflect.set(bundle, 'workflows', {})).toBe(false);
  expect(Reflect.set(bundle.workflows, 'inspect', undefined)).toBe(false);
  expect(Object.isFrozen(original)).toBe(false);
});

it('shares a narrow Step function while isolating member overrides, cardinality and trace names', async () => {
  const store = new Store();
  const inspect = readDefinition();
  const update = writeDefinition();
  expect(inspect.stepDefinitions.validate.step).toBe(update.stepDefinitions.validate.step);
  const changed = {
    ...inspect,
    stepOverrides: { validate: vi.fn(() => Promise.resolve()) },
  };
  const bundle = new WorkflowBundle({ resources: store, workflows: { inspect: changed, update } });
  const events: WorkflowEvent[] = [];
  await expect(bundle.workflows.inspect.run({ input: { id: '' } })).resolves.toBe('missing');
  await expect(bundle.workflows.update.run({ input: { id: '', value: 'no' } })).rejects.toThrow(
    'Record ID is required.'
  );
  await bundle.workflows.update.run({
    input: { id: 'one', value: 'A' },
    onEvent: (event) => {
      events.push(event);
    },
  });
  await bundle.workflows.inspect.run({
    input: { id: 'one' },
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(
    events.filter((event) => event.type === 'workflow-started').map((event) => event.workflowName)
  ).toEqual(['records.update', 'records.inspect']);
  expect(changed.stepOverrides.validate).toHaveBeenCalledTimes(2);
  expect(
    events.filter((event) => event.type === 'step-completed' && event.stepName === 'validate')
  ).toHaveLength(2);
});

it.each(['__proto__', 'constructor', 'toString'])(
  'supports the own member alias %s without prototype lookup or renaming its Workflow',
  async (key) => {
    const bundle = new WorkflowBundle({
      resources: new Store(),
      workflows: { [key]: readDefinition() },
    });
    const member = bundle.workflows[key];
    if (member === undefined) throw new Error('Member was not assembled.');
    expect(Object.keys(bundle.workflows)).toEqual([key]);
    expect(member.name).toBe('records.inspect');
    await expect(member.run({ input: { id: 'one' } })).resolves.toBe('missing');
  }
);
