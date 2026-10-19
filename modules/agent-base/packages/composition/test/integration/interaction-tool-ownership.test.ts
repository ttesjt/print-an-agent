import { setImmediate } from 'node:timers/promises';
import type { ActorInteractionHandler } from '@ta-agent/model-invocation-core';
import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@ta-agent/base-actor';
import { createToolRegistry, defineTool, type ToolExecutionRequest } from '@ta-agent/base-tool';
import { expect, it, vi } from 'vitest';
import { interactionAgent, interactionMessage } from '../support/interaction-agent.js';

function fixture(
  interact: ActorInteractionHandler,
  execute: (request: ToolExecutionRequest<unknown>) => Promise<{ text: string }>
) {
  return interactionAgent(interact, {
    actorCatalog: createActorCatalog({
      actors: [{ id: MAIN_ACTOR_ID, engineId: 'fixture', allowedTools: ['work'] }],
      engines: [
        {
          id: 'fixture',
          capabilities: {
            invocationModes: ['interaction'],
            inputMediaTypes: ['text'],
            interaction: { streamable: true },
            toolCalling: true,
            structuredOutput: false,
            cancellation: true,
          },
          interact,
        },
      ],
    }),
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) => ({
        ...definition,
        allowedTools: ['work'],
      })),
    }),
    toolRegistry: createToolRegistry([
      defineTool({
        name: 'work',
        description: 'Work',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        execute,
      }),
    ]),
    productToolAllowList: ['work'],
    runtimeToolAllowList: ['work'],
  });
}

it.each(['success', 'failure'] as const)(
  'keeps Session authority until ignored Tool work settles on Engine %s',
  async (mode) => {
    const started = Promise.withResolvers<AbortSignal>();
    const returned = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const error = new Error('Engine failed');
    const order: string[] = [];
    const configured = await fixture(
      async (request) => {
        void request.tools.execute({ callId: 'call', toolName: 'work', arguments: {} });
        await started.promise;
        if (mode === 'success')
          await request.emit({ type: 'assistant-complete', message: interactionMessage() });
        returned.resolve();
        if (mode === 'failure') throw error;
        return { message: interactionMessage() };
      },
      async ({ signal }) => {
        started.resolve(signal);
        await release.promise;
        order.push('tool-settled');
        return { text: 'done' };
      }
    );
    const commit = vi.spyOn(configured.session, 'completeTurn');
    const releaseAuthority = vi.spyOn(configured.session, 'releaseSessionExecution');
    const close = vi.spyOn(configured.output, 'close');
    const fail = vi.spyOn(configured.output, 'fail');
    const pending = configured.run();
    const observed = pending.catch(() => undefined);
    try {
      const signal = await started.promise;
      await returned.promise;
      await setImmediate();
      expect(commit).not.toHaveBeenCalled();
      expect(releaseAuthority).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(fail).not.toHaveBeenCalled();
      expect(signal.aborted).toBe(mode === 'failure');
      release.resolve();
      if (mode === 'failure') {
        await expect(pending).rejects.toBe(error);
        expect(commit).not.toHaveBeenCalled();
        expect(fail).toHaveBeenCalledOnce();
      } else {
        await expect(pending).resolves.toMatchObject({
          toolRun: { status: 'closed', records: [{ status: 'success' }] },
        });
        expect(commit).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
      }
      expect(order).toEqual(['tool-settled']);
      expect(releaseAuthority).toHaveBeenCalledOnce();
    } finally {
      release.resolve();
      await observed;
    }
  }
);

it('does not commit a Session when the Engine catches a terminal Tool rejection', async () => {
  let original: unknown;
  const configured = await interactionAgent(async (request) => {
    try {
      await request.tools.execute({ callId: 'call', toolName: 'forbidden', arguments: {} });
    } catch (cause: unknown) {
      original = cause;
    }
    await request.emit({ type: 'assistant-complete', message: interactionMessage() });
    return { message: interactionMessage() };
  });
  const commit = vi.spyOn(configured.session, 'completeTurn');
  const pending = configured.run();
  await expect(pending).rejects.toMatchObject({ code: 'TOOL_NOT_AUTHORIZED' });
  await expect(pending).rejects.toBe(original);
  expect(commit).not.toHaveBeenCalled();
  expect(configured.output.inspect()).toMatchObject({ status: 'failed' });
});
