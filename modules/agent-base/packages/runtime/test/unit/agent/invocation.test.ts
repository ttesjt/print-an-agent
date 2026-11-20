import { Agent, type BaseAgentRunContext } from '../../../src/index.js';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput } from '../../../src/index.js';
import { createAgent, defineAgentOperation } from '../../../src/index.js';
import {
  type NumberRunContext,
  numberWorkflow,
  type TextRunContext,
  textWorkflow,
} from '../../support/agent.js';

it('runs differently typed public Operations through one Agent owner', async () => {
  const text = textWorkflow('text', 'text');
  const number = numberWorkflow('number');
  const textOperation = defineAgentOperation({
    name: 'text',
    exposure: 'public',
    workflowPlan: [text],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): TextRunContext => ({ ...base, values: [] }),
  });
  const numberOperation = defineAgentOperation({
    name: 'number',
    exposure: 'public',
    workflowPlan: [number],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): NumberRunContext => ({ ...base }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { text: textOperation, number: numberOperation },
  });

  await expect(agent.invoke('text', 'hello')).resolves.toBe('text:hello');
  await expect(agent.invoke('number', 4)).resolves.toBe(8);
  expect(agent.operationNames).toEqual(['text', 'number']);
  expect(agent.workflowCatalog.names).toEqual(['text', 'number']);
});

it('rejects external invocation of an internal Operation', async () => {
  const workflow = numberWorkflow('internal-workflow');
  const internal = defineAgentOperation({
    name: 'internal',
    exposure: 'internal',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): NumberRunContext => ({ ...base }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { internal },
  });

  await expect(
    (agent.invoke as (name: string, input: number) => Promise<number>)('internal', 1)
  ).rejects.toMatchObject({ code: 'AGENT_OPERATION_NOT_PUBLIC' });
});

it('retains the Agent getter lookup after Run ID creation for subclassed owners', async () => {
  const order: string[] = [];
  const operation = defineAgentOperation({
    name: 'text',
    exposure: 'public',
    config: undefined,
    resources: undefined,
    workflowPlan: [],
    createRunId: () => {
      order.push('run-id');
      return 'subclass-run';
    },
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        undefined,
        undefined,
        Readonly<Record<never, never>>
      >
    ): BaseAgentRunContext<string, string> => ({ ...base, output: base.input }),
  });
  class ProductAgent extends Agent<undefined, { text: typeof operation }> {
    override get agentId() {
      order.push('agent-id');
      return super.agentId;
    }
  }
  const agent = new ProductAgent({
    identity: defineAgentIdentity({ id: 'product' }),
    resources: undefined,
    operations: { text: operation },
  });
  await expect(agent.invoke('text', 'result')).resolves.toBe('result');
  expect(order).toEqual(['run-id', 'agent-id']);
});
