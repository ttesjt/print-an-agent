import {
  Workflow,
  type WorkflowContext,
  type WorkflowDefinition,
  type StepOverrides,
  type RunnableWorkflow,
} from '@ta-agent/workflow-core';
import { recordUpdate, type UpdateContext } from '../consumers/record-update.js';

type Name = 'main' | 'child';
type Context = WorkflowContext<
  Name,
  { amount: number },
  { count: number },
  { save(value: number): Promise<void> },
  number
>;

// Compile-only negative contracts: never invoke this function or fabricate live contexts.
export function verifyContext(context: Context, other: UpdateContext): void {
  void context.runStep('child');
  void context.parallel(['main', 'child']);
  context.state.count++;
  context.result = context.input.amount;
  // @ts-expect-error names are the registered union, not arbitrary strings
  void context.runStep('missing');
  // @ts-expect-error parallel names follow exactly the same contract
  void context.parallel(['missing']);
  // @ts-expect-error framework execution fields are read-only
  context.signal = new AbortController().signal;
  // @ts-expect-error runner ownership cannot be replaced
  context.runStep = () => Promise.resolve();
  // @ts-expect-error state reference cannot be replaced, only its business contents
  context.state = { count: 3 };
  // @ts-expect-error result is a number, not a string or untyped override bag
  context.result = 'wrong';
  // @ts-expect-error consumers need not share compatible input/resources/result
  const mismatched: Context = other;
  void mismatched;
}

export const definitions: WorkflowDefinition<
  Name,
  Context['input'],
  Context['state'],
  Context['resources'],
  number
> = {
  name: 'typed',
  entryStep: 'main',
  createState: () => ({ count: 0 }),
  createResult: () => 0,
  stepDefinitions: {
    main: { step: (c) => c.runStep('child'), skippable: false, cardinality: 'at-most-once' },
    child: {
      step: async (c) => {
        await c.resources.save(c.input.amount);
        c.result = c.input.amount;
      },
      skippable: false,
      cardinality: 'repeatable',
    },
  },
};
const valid = new Workflow(definitions);
export const publicRunnable: RunnableWorkflow<Context['input'], Context['resources'], number> =
  valid;
export const invalidResult: typeof definitions = {
  ...definitions,
  // @ts-expect-error no uninitialized or fake-default result for a numeric result contract
  createResult: () => undefined,
};
export const invalidState: typeof definitions = {
  ...definitions,
  // @ts-expect-error a synchronous state factory cannot return a Promise of state
  createState: () => Promise.resolve({ count: 0 }),
};
export const invalidOverride: StepOverrides<Name, Context> = {
  // @ts-expect-error override cannot expect another consumer's context
  child: (context: UpdateContext) => context.runStep('commit'),
};

export function verifyCall(): void {
  // @ts-expect-error input must match the declared input shape
  void valid.run({ input: 'wrong', resources: { save: () => Promise.resolve() } });
  // @ts-expect-error required resource capability must be present
  void valid.run({ input: { amount: 1 }, resources: {} });
  void valid.run({
    input: { amount: 1 },
    resources: { save: () => Promise.resolve() },
    // @ts-expect-error no caller-supplied state or framework context
    state: { count: 0 },
  });
  const result = recordUpdate().run({
    input: { enabled: false, id: 'a', title: 'a' },
    resources: {
      records: {
        read: () => Promise.resolve({ revision: 1, title: 'a' }),
        compareAndSwap: () => Promise.resolve({ revision: 2, title: 'b' }),
      },
      titleLimit: () => Promise.resolve(20),
    },
  });
  // @ts-expect-error Workflow returns its consumer result, not a generic number or host context
  const wrong: Promise<number> = result;
  void wrong;
}
