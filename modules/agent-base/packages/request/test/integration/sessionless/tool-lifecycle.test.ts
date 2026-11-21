import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import type { InteractionTools } from '@print-an-agent/model-invocation-core';
import {
  createToolRegistry,
  DEFAULT_TOOL_EXECUTION_POLICY,
  defineTool,
  type ToolExecutionRequest,
} from '@print-an-agent/base-tool';
import { createSessionlessRequestWorkflow } from '../../../src/index.js';
import { assistant, interactionActor, outputChannel } from '../../support/sessionless/fixtures.js';

function tools(execute: (request: ToolExecutionRequest<unknown>) => Promise<{ text: string }>) {
  return {
    registry: createToolRegistry([
      defineTool({
        name: 'lookup',
        description: 'Look up facts',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        execute,
      }),
    ]),
    permissionPolicy: {
      responsibility: ['lookup'],
      actor: ['lookup'],
      product: ['lookup'],
      runtime: ['lookup'],
    },
  };
}

it.each(['success', 'failure'] as const)(
  'joins tools ignored by the Engine before publishing %s',
  async (mode) => {
    const started = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<void>();
    const engineFinished = Promise.withResolvers<void>();
    const failure = new Error('Engine failed');
    const order: string[] = [];
    let settled = false;
    let port: InteractionTools | undefined;
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: {
        actor: interactionActor(async (request) => {
          port = request.tools;
          void request.tools.execute({ callId: 'call', toolName: 'lookup', arguments: {} });
          await started.promise;
          if (mode === 'success')
            await request.emit({ type: 'assistant-complete', message: assistant() });
          engineFinished.resolve();
          if (mode === 'failure') throw failure;
          return { message: assistant() };
        }),
        tools: tools(async ({ signal }) => {
          started.resolve(signal);
          await release.promise;
          order.push('tool-settled');
          return { text: 'facts' };
        }),
        createOutputSink: () => ({
          ...outputChannel([]),
          close: () => {
            order.push('close');
            return Promise.resolve();
          },
          fail: () => {
            order.push('fail');
            return Promise.resolve();
          },
        }),
      },
      lifecycle: {
        onFinally: (context) => {
          expect(context.state.tools?.inspect().status).toBe('closed');
          expect(context.state.tools?.inspect().records).toHaveLength(1);
          order.push('finally');
        },
      },
    });
    const pending = workflow.run({ input: { message: 'hi' } }).finally(() => {
      settled = true;
    });
    const observed = pending.catch(() => undefined);
    try {
      const signal = await started.promise;
      await engineFinished.promise;
      await setImmediate();
      expect(settled).toBe(false);
      expect(order).toEqual([]);
      expect(signal.aborted).toBe(mode === 'failure');
      if (mode === 'failure') expect(signal.reason).toBe(failure);
      release.resolve();
      if (mode === 'failure') await expect(pending).rejects.toBe(failure);
      else
        await expect(pending).resolves.toMatchObject({
          toolRun: { status: 'closed', records: [{ callId: 'call', status: 'success' }] },
        });
      expect(order).toEqual(['tool-settled', mode === 'failure' ? 'fail' : 'close', 'finally']);
      if (port === undefined) throw new Error('Expected borrowed Tool port.');
      const late = port.execute({ callId: 'late', toolName: 'lookup', arguments: {} });
      if (mode === 'failure') await expect(late).rejects.toBe(failure);
      else await expect(late).rejects.toMatchObject({ code: 'TOOL_RUN_CLOSED' });
      expect(order).toEqual(['tool-settled', mode === 'failure' ? 'fail' : 'close', 'finally']);
    } finally {
      release.resolve();
      await observed;
    }
  }
);

it('rejects a late Tool result failure before publishing a successful terminal', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: unknown[] = [];
  const workflow = createSessionlessRequestWorkflow({
    mode: 'interaction',
    resources: {
      actor: interactionActor(async (request) => {
        void request.tools.execute({ callId: 'call', toolName: 'lookup', arguments: {} });
        await started.promise;
        await request.emit({ type: 'assistant-complete', message: assistant() });
        return { message: assistant() };
      }),
      tools: {
        ...tools(async () => {
          started.resolve();
          await release.promise;
          return { text: 'too much' };
        }),
        executionPolicy: { ...DEFAULT_TOOL_EXECUTION_POLICY, maxResultCharacters: 1 },
      },
      createOutputSink: () => outputChannel(events),
    },
  });
  const checked = expect(workflow.run({ input: { message: 'hi' } })).rejects.toMatchObject({
    code: 'TOOL_RESULT_TOO_LARGE',
  });
  await started.promise;
  expect(events).toMatchObject([{ type: 'opened' }]);
  release.resolve();
  await checked;
  expect(events).toMatchObject([
    { type: 'opened' },
    { type: 'failed', failure: { code: 'TOOL_RESULT_TOO_LARGE' } },
  ]);
});

it.each(['caught', 'floating'] as const)(
  'locks terminal tool rejection even when the Engine leaves it %s',
  async (mode) => {
    let executions = 0;
    let originalFailure: unknown;
    const events: unknown[] = [];
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: {
        tools: tools(() => {
          executions++;
          return Promise.resolve({ text: 'facts' });
        }),
        actor: interactionActor(async (request) => {
          const rejected = request.tools.execute({
            callId: 'forbidden',
            toolName: 'not-authorized',
            arguments: {},
          });
          const remembered = rejected.catch((cause: unknown) => {
            originalFailure = cause;
          });
          if (mode === 'caught') {
            await remembered;
            await expect(
              request.tools.execute({ callId: 'later', toolName: 'lookup', arguments: {} })
            ).rejects.toBe(originalFailure);
          } else {
            // Already queued work must also be cancelled before it reaches its handler.
            void request.tools.execute({ callId: 'queued', toolName: 'lookup', arguments: {} });
          }
          await request.emit({ type: 'assistant-complete', message: assistant() });
          return { message: assistant() };
        }),
        createOutputSink: () => outputChannel(events),
      },
    });
    const pending = workflow.run({ input: { message: 'hi' } });
    await expect(pending).rejects.toMatchObject({
      code: 'TOOL_NOT_AUTHORIZED',
    });
    await expect(pending).rejects.toBe(originalFailure);
    expect(originalFailure).toMatchObject({ code: 'TOOL_NOT_AUTHORIZED' });
    expect(executions).toBe(0);
    expect(events).toMatchObject([
      { type: 'opened' },
      { type: 'failed', failure: { code: 'TOOL_NOT_AUTHORIZED' } },
    ]);
  }
);

it('lets the model recover from a returned handler-error', async () => {
  const workflow = createSessionlessRequestWorkflow({
    mode: 'interaction',
    resources: {
      tools: tools(() => Promise.reject(new Error('recoverable handler failure'))),
      actor: interactionActor(async (request) => {
        await expect(
          request.tools.execute({ callId: 'call', toolName: 'lookup', arguments: {} })
        ).resolves.toMatchObject({ status: 'handler-error' });
        await request.emit({ type: 'assistant-complete', message: assistant('recovered') });
        return { message: assistant('recovered') };
      }),
    },
  });
  await expect(workflow.run({ input: { message: 'hi' } })).resolves.toMatchObject({
    message: { text: 'recovered' },
    toolRun: { status: 'closed', records: [{ status: 'handler-error' }] },
  });
});
