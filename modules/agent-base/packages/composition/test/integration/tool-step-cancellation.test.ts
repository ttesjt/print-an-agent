import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import { createPiFauxRuntime } from '@print-an-agent/model-invocation-pi';
import {
  createDefaultRequestStepOverrides,
  createRequestWorkflow,
  failRequest,
  releaseRequestExecution,
  type AgentResponse,
  type DefaultRequestWorkflowContext,
  type RequestAgentRunContext,
} from '@print-an-agent/base-request';
import { bindAgentWorkflow } from '@print-an-agent/base-runtime';
import { createToolRegistry, defineTool } from '@print-an-agent/base-tool';
import { expect, it, vi } from 'vitest';
import { defaultRequestStep, interactionAgent } from '../support/interaction-agent.js';

it('drains the real Pi tool loop after Step executor failure before closing Request resources', async () => {
  const parent = new AbortController();
  const toolStarted = Promise.withResolvers<AbortSignal>();
  const stepCancelled = Promise.withResolvers<void>();
  const releaseTool = Promise.withResolvers<void>();
  const failure = new Error('executor failed');
  const order: string[] = [];
  const sideEffect = vi.fn();
  const tool = defineTool({
    name: 'work',
    description: 'Work that must stop before committing.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    execute: async ({ signal }) => {
      toolStarted.resolve(signal);
      try {
        await releaseTool.promise;
        signal.throwIfAborted();
        sideEffect();
        return { text: 'done' };
      } finally {
        order.push('tool-exit');
      }
    },
  });
  const createWorkflow = (resources: DefaultRequestWorkflowContext['resources']) => {
    const workflow = createRequestWorkflow<
      RequestAgentRunContext,
      DefaultRequestWorkflowContext['state'],
      DefaultRequestWorkflowContext['resources'],
      AgentResponse
    >({
      resources,
      createState: ({ input }) => ({ agentRun: input }),
      stepOverrides: {
        ...createDefaultRequestStepOverrides(),
        buildTools: async (context) => {
          await defaultRequestStep('buildTools')(context);
          const tools = context.state.tools;
          if (tools === undefined) throw new Error('Expected tools');
          const close = tools.close.bind(tools);
          vi.spyOn(tools, 'close').mockImplementation(() => {
            order.push('tools-close');
            close();
          });
        },
      },
      lifecycle: { onError: failRequest, onFinally: releaseRequestExecution },
      executeStep: async ({ stepName, step, context }) => {
        if (stepName === 'invokeActorInteraction') {
          context.signal.addEventListener('abort', () => stepCancelled.resolve(), { once: true });
          void step(context).catch(() => undefined);
          await toolStarted.promise;
          throw failure;
        }
        await step(context);
      },
    });
    return bindAgentWorkflow({
      projectInput: (context: RequestAgentRunContext) => context,
      workflow,
      applyResult(context, result) {
        if (result !== undefined) context.output = result;
      },
    });
  };
  const profile = createPiFauxRuntime({
    responses: [
      { status: 'tool-call', name: 'work', callId: 'call', arguments: {} },
      { status: 'success', text: 'unreachable' },
    ],
  });
  const fixture = await interactionAgent(
    () => Promise.reject(new Error('unused Engine')),
    {
      actorCatalog: createActorCatalog({
        actors: [{ id: MAIN_ACTOR_ID, engineId: profile.actorEngine.id, allowedTools: ['work'] }],
        engines: [profile.actorEngine],
      }),
      responsibilityCatalog: createResponsibilityCatalog({
        responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) => ({
          ...definition,
          allowedTools: ['work'],
        })),
      }),
      toolRegistry: createToolRegistry([tool]),
      productToolAllowList: ['work'],
      runtimeToolAllowList: ['work'],
    },
    createWorkflow
  );
  const release = vi.spyOn(fixture.session, 'releaseSessionExecution');
  const commit = vi.spyOn(fixture.session, 'completeTurn');
  const fail = vi.spyOn(fixture.output, 'fail');
  const close = vi.spyOn(fixture.output, 'close');
  const run = fixture.run(parent.signal);
  const observed = run.catch(() => undefined);
  try {
    const signal = await toolStarted.promise;
    await stepCancelled.promise;
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(failure);
    expect(order).toEqual([]);
    expect(fail).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    releaseTool.resolve();
    await expect(run).rejects.toMatchObject({
      errors: [failure, expect.objectContaining({ code: 'TOOL_EXECUTION_CANCELLED' })],
    });
    expect(order[0]).toBe('tool-exit');
    expect(order).toContain('tools-close');
    expect(sideEffect).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(parent.signal.aborted).toBe(false);
    expect(profile.inspect().callCount).toBe(1);
  } finally {
    releaseTool.resolve();
    await observed;
  }
});
