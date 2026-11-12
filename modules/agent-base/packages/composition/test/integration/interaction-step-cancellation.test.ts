import {
  createDefaultRequestStepOverrides,
  createRequestWorkflow,
  failRequest,
  parseRequestIdempotencyKey,
  releaseRequestExecution,
  type AgentResponse,
  type DefaultRequestWorkflowContext,
  type RequestAgentRunContext,
} from '@print-an-agent/base-request';
import { bindAgentWorkflow } from '@print-an-agent/base-runtime';
import { parseSessionId } from '@print-an-agent/base-session';
import { expect, it, vi } from 'vitest';
import { defaultRequestStep, interactionAgent } from '../support/interaction-agent.js';

it.each(['executor', 'delivery'] as const)(
  'cancels the active Actor after %s failure and drains before Request cleanup',
  async (failureSource) => {
    const source = new AbortController();
    const started = Promise.withResolvers<void>();
    const stepCancelled = Promise.withResolvers<void>();
    const actorCancelled = Promise.withResolvers<void>();
    const releaseActor = Promise.withResolvers<void>();
    const failure = new Error(`${failureSource} failed`);
    const order: string[] = [];
    let actorSignal: AbortSignal | undefined;
    const createWorkflow = (resources: DefaultRequestWorkflowContext['resources']) => {
      const workflow = createRequestWorkflow<
        RequestAgentRunContext,
        DefaultRequestWorkflowContext['state'],
        DefaultRequestWorkflowContext['resources'],
        AgentResponse
      >({
        resources,
        createState: () => ({}),
        stepOverrides: {
          ...createDefaultRequestStepOverrides(),
          buildTools: async (context) => {
            await defaultRequestStep('buildTools')(context);
            const tools = context.state.tools;
            if (tools === undefined) throw new Error('Expected Tools.');
            context.state.tools = {
              tools: tools.tools,
              execute: tools.execute.bind(tools),
              inspect: tools.inspect.bind(tools),
              close: () => {
                order.push('tools-close');
                tools.close();
              },
            };
          },
        },
        lifecycle: { onError: failRequest, onFinally: releaseRequestExecution },
        executeStep: async ({ stepName, step, context }) => {
          if (failureSource === 'executor' && stepName === 'invokeActorInteraction') {
            context.signal.addEventListener('abort', () => stepCancelled.resolve(), { once: true });
            void step(context).catch(() => undefined);
            await started.promise;
            throw failure;
          }
          await step(context);
        },
      });
      return bindAgentWorkflow({
        workflow,
        applyResult(context, result) {
          if (result !== undefined) context.output = result;
        },
      });
    };
    const fixture = await interactionAgent(
      async (request) => {
        actorSignal = request.signal;
        request.signal.addEventListener('abort', () => actorCancelled.resolve(), { once: true });
        started.resolve();
        if (failureSource === 'delivery') {
          void request.emit({ type: 'text-delta', delta: 'A' }).catch(() => undefined);
        }
        await actorCancelled.promise;
        await releaseActor.promise;
        order.push('actor-exit');
        throw request.signal.reason;
      },
      {},
      createWorkflow
    );
    if (failureSource === 'delivery') vi.spyOn(fixture.output, 'write').mockRejectedValue(failure);
    const release = vi.spyOn(fixture.session, 'releaseSessionExecution');
    const fail = vi.spyOn(fixture.output, 'fail');
    const close = vi.spyOn(fixture.output, 'close');
    const run = fixture.run(source.signal);
    // Keep a rejection handler attached even when an assertion fails before final settlement.
    const settled = run.catch(() => undefined);
    try {
      await started.promise;
      if (failureSource === 'executor') {
        await stepCancelled.promise;
        expect(actorSignal?.aborted).toBe(true);
        expect(actorSignal?.reason).toBe(failure);
      }
      await actorCancelled.promise;
      expect(actorSignal?.aborted).toBe(true);
      expect(fail).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      expect(order).toEqual([]);
      expect(fixture.output.inspect()).toMatchObject({ status: 'open' });
      releaseActor.resolve();
      if (failureSource === 'executor') {
        await expect(run).rejects.toBe(failure);
      } else {
        await expect(run).rejects.toMatchObject({ code: 'REQUEST_OUTPUT_FAILED', cause: failure });
        expect(actorSignal?.aborted).toBe(true);
      }
      expect(source.signal.aborted).toBe(false);
      expect(order[0]).toBe('actor-exit');
      expect(order).toContain('tools-close');
      expect(fail).toHaveBeenCalledOnce();
      expect(close).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledOnce();
      expect(fixture.output.inspect()).toMatchObject({ status: 'failed' });
      expect(
        await fixture.session.inspect({
          agentId: fixture.agent.identity.id,
          sessionId: parseSessionId('session'),
        })
      ).toMatchObject({ turns: [{ status: 'failed' }] });
      expect(
        await fixture.journal.inspect({
          agentId: fixture.agent.identity.id,
          sessionId: parseSessionId('session'),
          idempotencyKey: parseRequestIdempotencyKey('request'),
        })
      ).toMatchObject({ status: 'failed' });
    } finally {
      source.abort();
      releaseActor.resolve();
      await settled;
    }
  }
);
