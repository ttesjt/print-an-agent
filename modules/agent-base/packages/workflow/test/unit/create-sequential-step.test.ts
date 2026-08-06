import { describe, expect, it } from 'vitest';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import type { BaseWorkflowContext } from '../../src/index.js';
import { createSequentialStep } from '../../src/index.js';

describe('createSequentialStep', () => {
  it('resolves children through the current Workflow Context in order', async () => {
    type StepName = 'first' | 'second';
    const calls: StepName[] = [];
    const step = createSequentialStep<StepName>('first', 'second');
    const context: BaseWorkflowContext<StepName> = {
      workflowName: 'workflow',
      workflowRunId: 'workflow-run',
      agentContext: {
        identity: defineAgentIdentity({ id: 'agent' }),
        runId: 'agent-run',
        input: undefined,
        signal: new AbortController().signal,
      },
      signal: new AbortController().signal,
      runStep: (stepName) => {
        calls.push(stepName);
        return Promise.resolve();
      },
    };

    await step(context);

    expect(calls).toEqual(['first', 'second']);
  });
});
