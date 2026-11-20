import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { type AgentTraceEvent } from '@print-an-agent/base-observability';
import {
  bindAgentWorkflow,
  createAgent,
  defineAgentOperation,
  type AgentRunContextFactoryInput,
  type BaseAgentRunContext,
} from '@print-an-agent/base-runtime';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect, it, vi } from 'vitest';

it('fails the Agent Run before a broad-input Workflow can succeed or apply a result', async () => {
  type Run = BaseAgentRunContext<string, string>;
  const events: AgentTraceEvent[] = [];
  const step = vi.fn(() => Promise.resolve());
  const applyResult = vi.fn((run: Run, result: string) => {
    run.output = result;
  });
  let sourceRun: Run | undefined;
  const workflow = new Workflow<'execute', unknown, undefined, undefined, string>({
    name: 'unknown-input',
    resources: undefined,
    entryStep: 'execute',
    createState: () => undefined,
    createResult: () => 'incorrect success',
    stepDefinitions: {
      execute: { cardinality: STEP_CARDINALITY.AT_MOST_ONCE, skippable: false, step },
    },
  });
  const binding = bindAgentWorkflow({
    workflow,
    projectInput: async (_run: Run) => {
      await Promise.resolve();
      throw new Error('private projection failure');
    },
    applyResult,
  });
  const operation = defineAgentOperation({
    name: 'projected',
    exposure: 'public',
    config: undefined,
    resources: undefined,
    workflowPlan: [binding],
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        undefined,
        undefined,
        Readonly<Record<never, never>>
      >
    ): Run => {
      sourceRun = { ...base, output: 'existing' };
      return sourceRun;
    },
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'projection-agent' }),
    resources: undefined,
    operations: { projected: operation },
    observability: {
      sink: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
    },
  });

  await expect(agent.invoke('projected', 'input')).rejects.toMatchObject({
    code: 'WORKFLOW_INPUT_PROJECTION_ASYNC',
    subjectName: 'unknown-input',
  });
  expect(sourceRun?.output).toBe('existing');
  expect(step).not.toHaveBeenCalled();
  expect(applyResult).not.toHaveBeenCalled();
  expect(events.map((event) => event.type)).toEqual(['agent-run-started', 'agent-run-failed']);
  expect(events[1]).toMatchObject({
    errorCode: 'WORKFLOW_INPUT_PROJECTION_ASYNC',
    agentId: 'projection-agent',
    operationName: 'projected',
  });
  expect(JSON.stringify(events)).not.toContain('private projection failure');
  await new Promise<void>((resolve) => setImmediate(resolve));
});
