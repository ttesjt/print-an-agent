import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput, BaseAgentRunContext } from '../../../src/index.js';
import {
  createAgent,
  defineAgentOperation,
  defineAgentOperationReference,
} from '../../../src/index.js';
import {
  expectDefinitionError,
  type NumberRunContext,
  numberWorkflow,
  type TextRunContext,
  textWorkflow,
} from '../../support/agent.js';

it('reuses one Agent-owned Workflow in multiple Operation plans', async () => {
  const shared = textWorkflow('shared', 'shared');
  const extra = textWorkflow('extra', 'extra');
  const createContext = (
    base: AgentRunContextFactoryInput<
      string,
      Readonly<Record<string, never>>,
      Readonly<Record<string, never>>,
      Readonly<Record<never, never>>
    >
  ): TextRunContext => ({ ...base, values: [] });
  const standard = defineAgentOperation({
    name: 'standard',
    exposure: 'public',
    workflowPlan: [shared],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext,
  });
  const extended = defineAgentOperation({
    name: 'extended',
    exposure: 'public',
    workflowPlan: [shared, extra],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext,
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { standard, extended },
  });

  await expect(agent.invoke('standard', 'hello')).resolves.toBe('shared:hello');
  await expect(agent.invoke('extended', 'hello')).resolves.toBe('shared:hello|extra:hello');
  expect(agent.workflowCatalog.get('shared')).toBe(shared);
});

it('rejects conflicting definitions for one Agent-owned Workflow name', () => {
  const first = textWorkflow('shared', 'first');
  const second = textWorkflow('shared', 'second');
  const createContext = (
    base: AgentRunContextFactoryInput<
      string,
      Readonly<Record<string, never>>,
      Readonly<Record<string, never>>,
      Readonly<Record<never, never>>
    >
  ): TextRunContext => ({ ...base, values: [] });
  const one = defineAgentOperation({
    name: 'one',
    exposure: 'public',
    workflowPlan: [first],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext,
  });
  const two = defineAgentOperation({
    name: 'two',
    exposure: 'public',
    workflowPlan: [second],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext,
  });
  expectDefinitionError(
    () =>
      createAgent({
        identity: defineAgentIdentity({ id: 'agent' }),
        resources: Object.freeze({}),
        operations: { one, two },
      }),
    'WORKFLOW_NAME_DUPLICATE'
  );
});

it('rejects mismatched Operation registration keys and callable references', () => {
  const workflow = numberWorkflow('number-workflow');
  const number = defineAgentOperation({
    name: 'number',
    exposure: 'public',
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
  expectDefinitionError(
    () =>
      createAgent({
        identity: defineAgentIdentity({ id: 'agent' }),
        resources: Object.freeze({}),
        operations: { wrong: number },
      }),
    'AGENT_OPERATION_NAME_MISMATCH'
  );

  const forgedReference = defineAgentOperationReference<'number', number, number>('number');
  const callableOperations = Object.freeze({ number: forgedReference });
  type ParentContext = BaseAgentRunContext<string, string, typeof callableOperations> &
    Readonly<{ values: string[] }>;
  const parent = defineAgentOperation({
    name: 'parent',
    exposure: 'public',
    workflowPlan: [textWorkflow('parent-workflow', 'parent')],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    callableOperations,
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        typeof callableOperations
      >
    ): ParentContext => ({ ...base, values: [] }),
  });
  expectDefinitionError(
    () =>
      createAgent({
        identity: defineAgentIdentity({ id: 'agent' }),
        resources: Object.freeze({}),
        operations: { parent, number },
      }),
    'AGENT_OPERATION_REFERENCE_MISMATCH'
  );
});
