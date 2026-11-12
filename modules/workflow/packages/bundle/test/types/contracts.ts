import { Workflow, type RunnableWorkflow } from '@print-an-agent/workflow-core';
import { WorkflowBundle, type BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';
import {
  readDefinition,
  writeDefinition,
  type ReadContext,
  type WriteContext,
} from '../support/definitions.js';

const resources = {
  read: () => Promise.resolve('value'),
  write: () => Promise.resolve(),
  close: () => undefined,
};
const definitions = { update: writeDefinition(), inspect: readDefinition() };
interface NamedDefinitions {
  update: ReturnType<typeof writeDefinition>;
  inspect: ReturnType<typeof readDefinition>;
}
const named: NamedDefinitions = definitions;
export const fromInterface = new WorkflowBundle({ resources, workflows: named });
const bundle = new WorkflowBundle({ resources, workflows: definitions });
export const inspect: RunnableWorkflow<{ id: string }, string> = bundle.workflows.inspect;
export const update: RunnableWorkflow<{ id: string; value: string }, number> =
  bundle.workflows.update;

// Compile-only: no execution or invalid construction during tests.
export function checkCalls(): void {
  const text: Promise<string> = bundle.workflows.inspect.run({ input: { id: 'id' } });
  const length: Promise<number> = bundle.workflows.update.run({
    input: { id: 'id', value: 'new' },
  });
  void text;
  void length;
  // @ts-expect-error member names are the exact definition keys
  void bundle.workflows.missing;
  // @ts-expect-error independent inputs must not collapse into a union or unknown
  void bundle.workflows.update.run({ input: { id: 'id' } });
  // @ts-expect-error inspect has a string result
  const wrong: Promise<number> = bundle.workflows.inspect.run({ input: { id: 'id' } });
  void wrong;
  // @ts-expect-error members are read-only
  bundle.workflows.inspect = inspect;
  // @ts-expect-error the collection reference is read-only
  bundle.workflows = { ...bundle.workflows };
  // @ts-expect-error Resources must cover the update member's write capability
  new WorkflowBundle({ resources: { read: resources.read }, workflows: definitions });
  const choice = Math.random() > 0.5 ? readDefinition() : writeDefinition();
  // @ts-expect-error Resources must cover every possible member, not only the read alternative
  new WorkflowBundle({ resources: { read: resources.read }, workflows: { choice } });
  const dynamic = new WorkflowBundle({ resources, workflows: { choice } });
  // @ts-expect-error a dynamic member may require write input, even when read input is simpler
  void dynamic.workflows.choice.run({ input: { id: 'id' } });
  void dynamic.workflows.choice.run({ input: { id: 'id', value: 'new' } });
  const optional: Partial<typeof definitions> = {};
  // @ts-expect-error members must be complete definitions rather than possibly undefined
  new WorkflowBundle({ resources, workflows: optional });
  new WorkflowBundle({
    resources,
    // @ts-expect-error member maps cannot contain symbol keys
    workflows: { [Symbol('hidden')]: readDefinition() },
  });
  new WorkflowBundle({
    resources,
    workflows: {
      // @ts-expect-error members cannot bind another resource object
      inspect: { ...readDefinition(), resources },
    },
  });
  const standalone = new Workflow({ ...readDefinition(), resources });
  new WorkflowBundle({
    resources,
    workflows: {
      // @ts-expect-error Bundle constructs Workflows from definitions, not existing instances
      inspect: standalone,
    },
  });
  // @ts-expect-error calling a member cannot rebind its Resources
  void bundle.workflows.inspect.run({ input: { id: 'id' }, resources });
}

export const incompatibleStep: BundleWorkflowDefinition<
  'read' | 'validate',
  ReadContext['input'],
  void,
  ReadContext['resources'],
  string
> = {
  ...readDefinition(),
  stepOverrides: {
    // @ts-expect-error shared Steps must accept the member's real Context
    read: (_context: WriteContext) => Promise.resolve(),
  },
};
