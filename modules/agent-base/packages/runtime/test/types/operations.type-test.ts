import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import {
  type AgentOperationReference,
  createAgent,
  defineAgentOperation,
  type AgentRunContextFactoryInput,
  type BaseAgentRunContext,
} from '../../src/index.js';

export function verifyPublicOperationTypes(): void {
  type TextRun = BaseAgentRunContext<string, string>;
  type NumberRun = BaseAgentRunContext<number, number>;
  const text = defineAgentOperation({
    name: 'text',
    exposure: 'public',
    config: undefined,
    resources: undefined,
    workflowPlan: [],
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        undefined,
        undefined,
        Readonly<Record<never, never>>
      >
    ): TextRun => ({ ...base, output: base.input }),
  });
  const internal = defineAgentOperation({
    name: 'internal',
    exposure: 'internal',
    config: undefined,
    resources: undefined,
    workflowPlan: [],
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        undefined,
        undefined,
        Readonly<Record<never, never>>
      >
    ): NumberRun => ({ ...base, output: base.input }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'type-qualification' }),
    resources: { marker: 'product' as const },
    operations: { text, internal },
  });
  const result: Promise<string> = agent.invoke('text', 'input');
  const marker: 'product' = agent.resources.marker;
  void result;
  void marker;
  // @ts-expect-error The selected public Operation preserves its input type.
  void agent.invoke('text', 1);
  // @ts-expect-error Internal Operations are not exposed by the public invoker.
  void agent.invoke('internal', 1);
  // @ts-expect-error Only registered Operation names are accepted.
  void agent.invoke('missing', 'input');
}

type ChildReference = AgentOperationReference<'child', number, string>;
type ChildRun = BaseAgentRunContext<unknown, unknown, Readonly<{ child: ChildReference }>>;
export function verifyNarrowChildInvoker(run: ChildRun): void {
  const output: Promise<string> = run.operations.invoke('child', 1);
  void output;
  // @ts-expect-error Child invocation retains the reference's input contract.
  void run.operations.invoke('child', 'wrong input');
  // @ts-expect-error An undeclared child cannot be invoked.
  void run.operations.invoke('other', 1);
}
