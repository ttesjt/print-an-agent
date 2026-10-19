import { describe, expect, it } from 'vitest';
import {
  AgentToolError,
  createToolRegistry,
  defineTool,
  defineToolPermissionPolicy,
} from '@ta-agent/base-tool';
import { SKIP_STEP } from '@ta-agent/workflow-core';
import {
  createSessionlessRequestWorkflow,
  defineSessionlessInteractionPolicy,
} from '../../src/index.js';
import { assistant, interactionActor, outputChannel } from '../support/sessionless.js';

const permissionPolicy = defineToolPermissionPolicy({
  responsibility: ['lookup'],
  actor: ['lookup'],
  product: ['lookup'],
  runtime: ['lookup'],
});
function registry(
  execute: () => Promise<{ text: string }> = () => Promise.resolve({ text: 'facts' })
) {
  return createToolRegistry([
    defineTool({
      name: 'lookup',
      description: 'Look up facts',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      execute,
    }),
  ]);
}

describe('Sessionless Interaction', () => {
  it('rejects malformed budgets and configuration accessors before evaluating them', () => {
    for (const value of [0, null, undefined, Number.POSITIVE_INFINITY]) {
      expect(() => defineSessionlessInteractionPolicy({ maxModelTurns: value })).toThrow(
        'model-turn budget'
      );
    }
    expect(() => defineSessionlessInteractionPolicy({ unknown: 1 })).toThrow('unsupported field');
    expect(() => {
      Reflect.apply(createSessionlessRequestWorkflow, undefined, [
        {
          get mode() {
            throw new Error('must not execute');
          },
        },
      ]);
    }).toThrow('unsupported field or accessor');
  });
  it('uses explicit permissions, run-local tool state and all-turn reasoning without a Session', async () => {
    const channels: unknown[][] = [];
    const actor = interactionActor(async (request) => {
      await request.emit({ type: 'turn-start' });
      await request.emit({ type: 'reasoning-delta', delta: 'before tool' });
      const outcome = await request.tools.execute({
        callId: 'call',
        toolName: 'lookup',
        arguments: {},
      });
      expect(outcome).toEqual({ status: 'success', text: 'facts' });
      await request.emit({ type: 'turn-end' });
      await request.emit({ type: 'turn-start' });
      await request.emit({ type: 'reasoning-delta', delta: 'after tool' });
      await request.emit({ type: 'text-delta', delta: 'answer' });
      await request.emit({ type: 'assistant-complete', message: assistant() });
      return { message: assistant() };
    });
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: {
        actor,
        tools: { registry: registry(), permissionPolicy },
        createOutputSink: () => {
          const events: unknown[] = [];
          channels.push(events);
          return outputChannel(events);
        },
      },
    });
    const results = await Promise.all([
      workflow.run({ input: { message: 'one' } }),
      workflow.run({ input: { message: 'two' } }),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({
        message: { text: 'answer' },
        toolRun: { status: 'closed', records: [{ callId: 'call', status: 'success' }] },
      });
      expect(result).not.toHaveProperty('sessionId');
    }
    for (const events of channels)
      expect(events).toMatchObject([
        { type: 'opened' },
        { type: 'reasoning-delta', delta: 'before tool' },
        { type: 'reasoning-delta', delta: 'after tool' },
        { type: 'text-delta' },
        { type: 'closed' },
      ]);
  });

  it('does not grant tools by model capability or by registry membership', async () => {
    let executions = 0;
    const actor = interactionActor(async (request) => {
      expect(request.tools.tools).toEqual([]);
      await request.tools.execute({ callId: 'call', toolName: 'lookup', arguments: {} });
      return { message: assistant() };
    });
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: {
        actor,
        tools: {
          registry: registry(() => {
            executions++;
            return Promise.resolve({ text: 'facts' });
          }),
        },
      },
    });
    await expect(workflow.run({ input: { message: 'hi' } })).rejects.toMatchObject({
      code: 'TOOL_NOT_AUTHORIZED',
    });
    expect(executions).toBe(0);
  });

  it('accepts empty tools and preserves the one-turn budget as Interaction semantics', async () => {
    const actor = interactionActor(async (request) => {
      expect(request.tools.tools).toEqual([]);
      await request.emit({ type: 'turn-start' });
      await request.emit({ type: 'turn-end' });
      await request.emit({ type: 'turn-start' });
      return { message: assistant() };
    });
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: { actor, policy: { maxModelTurns: 1 } },
    });
    await expect(workflow.run({ input: { message: 'hi' } })).rejects.toMatchObject({
      code: 'MODEL_TURN_LIMIT_EXCEEDED',
    });
  });

  it('enforces reasoning budget even when delivery is skipped', async () => {
    const actor = interactionActor(async (request) => {
      await request.emit({ type: 'reasoning-delta', delta: 'too much' });
      await request.emit({ type: 'assistant-complete', message: assistant() });
      return { message: assistant() };
    });
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: { actor, policy: { maxReasoningCharacters: 2 } },
      stepOverrides: { deliverReasoningDelta: SKIP_STEP },
    });
    await expect(workflow.run({ input: { message: 'hi' } })).rejects.toMatchObject({
      code: 'MODEL_REASONING_LIMIT_EXCEEDED',
    });
  });

  it('drains a cancelled tool before output failure and closes tools even after preparation failure', async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const calls: string[] = [];
    const tools = registry(async () => {
      started.resolve();
      await release.promise;
      calls.push('handler-settled');
      return { text: 'facts' };
    });
    const actor = interactionActor(async (request) => {
      await request.tools.execute({ callId: 'call', toolName: 'lookup', arguments: {} });
      return { message: assistant() };
    });
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: {
        actor,
        tools: { registry: tools, permissionPolicy },
        createOutputSink: () => ({
          ...outputChannel([]),
          fail: () => {
            calls.push('fail');
            return Promise.resolve();
          },
        }),
      },
      lifecycle: {
        onFinally: (context) => {
          expect(context.state.tools?.inspect().status).toBe('closed');
          calls.push('finally');
        },
      },
    });
    const pending = workflow.run({ input: { message: 'hi' }, signal: controller.signal });
    await started.promise;
    controller.abort(new Error('caller'));
    await Promise.resolve();
    expect(calls).toEqual([]);
    release.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'TOOL_EXECUTION_CANCELLED' });
    expect(calls).toEqual(['handler-settled', 'fail', 'finally']);

    const broken = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: { actor },
      stepOverrides: {
        buildModelContext: () =>
          Promise.reject(new AgentToolError('TOOL_ARGUMENTS_INVALID', 'preparation')),
      },
      lifecycle: {
        onError: (context) => {
          expect(context.state.tools?.inspect().status).toBe('closed');
        },
      },
    });
    await expect(broken.run({ input: { message: 'hi' } })).rejects.toMatchObject({
      code: 'TOOL_ARGUMENTS_INVALID',
    });
  });

  it('keeps handler errors recoverable and duplicate call IDs terminal', async () => {
    const actor = interactionActor(async (request) => {
      const outcome = await request.tools.execute({
        callId: 'same',
        toolName: 'lookup',
        arguments: {},
      });
      expect(outcome.status).toBe('handler-error');
      await request.tools.execute({ callId: 'same', toolName: 'lookup', arguments: {} });
      return { message: assistant() };
    });
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: {
        actor,
        tools: { registry: registry(() => Promise.reject(new Error('handler'))), permissionPolicy },
      },
    });
    await expect(workflow.run({ input: { message: 'hi' } })).rejects.toMatchObject({
      code: 'TOOL_CALL_DUPLICATE',
    });
  });
});
