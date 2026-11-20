import { createAgentTraceEmitter, type AgentTraceEvent } from '@print-an-agent/base-observability';
import { skipWorkflow } from '@print-an-agent/workflow-core';
import { expect, it, vi } from 'vitest';
import { bindAgentWorkflow } from '../../../src/index.js';
import { context, workflow, type Run } from '../../support/workflow-binding.js';

it('returns Core results, applies only to their owning Agent Run and does not mutate before application', async () => {
  const run = context();
  const binding = bindAgentWorkflow({
    projectInput: (context: Run) => context,
    workflow: workflow(),
    applyResult(target, result) {
      if (result !== undefined) target.output = result;
    },
  });
  const result = await binding.run(run);
  expect(result.result).toBe('output');
  expect(run.output).toBeUndefined();
  await expect(result.applyTo(context())).rejects.toMatchObject({
    code: 'WORKFLOW_RESULT_CONTEXT_MISMATCH',
  });
  await result.applyTo(run);
  expect(run.output).toBe('output');
});

it('applies a skipped no-change result without overwriting an existing Agent Run output', async () => {
  const run = context();
  run.output = 'existing';
  const child = vi.fn();
  const binding = bindAgentWorkflow({
    projectInput: (context: Run) => context,
    workflow: workflow({ condition: () => skipWorkflow('not-needed'), stepOverrides: { child } }),
    applyResult(target, result) {
      if (result !== undefined) target.output = result;
    },
  });
  await (await binding.run(run)).applyTo(run);
  expect(run.output).toBe('existing');
  expect(child).not.toHaveBeenCalled();
});

it('records a recovered child error with safe classification and exact Agent/Run correlation', async () => {
  const events: AgentTraceEvent[] = [];
  const traceEmitter = createAgentTraceEmitter({
    agentId: 'agent',
    agentRunId: 'agent-run',
    sink: {
      record: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  });
  const run = { ...context(), traceEmitter };
  const error = Object.assign(new Error('private payload'), { code: 'RECORD_CONFLICT' });
  const binding = bindAgentWorkflow({
    projectInput: (context: Run) => context,
    applyResult: () => undefined,
    workflow: workflow({
      createRunId: () => 'workflow-run',
      stepOverrides: {
        child: () => Promise.reject(error),
        entry: async (ctx) => {
          try {
            await ctx.runStep('child');
          } catch {
            ctx.state.output = 'recovered';
          }
        },
      },
    }),
  });
  expect((await binding.run(run)).result).toBe('recovered');
  // Agent owns delivery flush, not Core or the binding.
  await traceEmitter.record({ type: 'agent-run-completed', operationName: 'request' });
  expect(events.find((e) => e.type === 'step-failed')).toMatchObject({
    agentId: 'agent',
    agentRunId: 'agent-run',
    workflowRunId: 'workflow-run',
    workflowName: 'test',
    stepName: 'child',
    errorCode: 'RECORD_CONFLICT',
  });
  expect(events.some((e) => e.type === 'workflow-run-failed')).toBe(false);
  expect(JSON.stringify(events)).not.toContain('private payload');
});

it('does not wait on a stalled trace observer or change a failure', async () => {
  const failure = new Error('work');
  const cleanup = vi.fn();
  const run = {
    ...context(),
    traceEmitter: {
      agentId: 'agent',
      agentRunId: 'agent-run',
      record: () => new Promise<void>(() => undefined),
    },
  };
  const binding = bindAgentWorkflow({
    projectInput: (context: Run) => context,
    applyResult: () => undefined,
    workflow: workflow({
      stepOverrides: { child: () => Promise.reject(failure) },
      lifecycle: { onFinally: cleanup },
    }),
  });
  await expect(binding.run(run)).rejects.toBe(failure);
  expect(cleanup).toHaveBeenCalledOnce();
});

it('correlates each skipped Workflow terminal with its own started Run', async () => {
  const events: AgentTraceEvent[] = [];
  const traceEmitter = createAgentTraceEmitter({
    agentId: 'agent',
    agentRunId: 'agent-run',
    sink: {
      record: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  });
  let nextId = 0;
  const binding = bindAgentWorkflow({
    projectInput: (context: Run) => context,
    workflow: workflow({
      createRunId: () => `skipped-${++nextId}`,
      condition: () => skipWorkflow('not-needed'),
    }),
    applyResult: () => undefined,
  });
  const run = { ...context(), traceEmitter };
  await binding.run(run);
  await binding.run(run);
  await traceEmitter.record({ type: 'agent-run-completed', operationName: 'request' });
  expect(events.filter((event) => event.type.startsWith('workflow-run-'))).toEqual([
    expect.objectContaining({ type: 'workflow-run-started', workflowRunId: 'skipped-1' }),
    expect.objectContaining({ type: 'workflow-run-skipped', workflowRunId: 'skipped-1' }),
    expect.objectContaining({ type: 'workflow-run-started', workflowRunId: 'skipped-2' }),
    expect.objectContaining({ type: 'workflow-run-skipped', workflowRunId: 'skipped-2' }),
  ]);
});
