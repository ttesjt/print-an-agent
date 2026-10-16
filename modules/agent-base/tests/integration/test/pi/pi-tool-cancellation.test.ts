import { expect, it } from 'vitest';
import {
  createBoundedToolRuntime,
  createToolRegistry,
  DEFAULT_TOOL_EXECUTION_POLICY,
  defineTool,
  defineToolPermissionPolicy,
} from '@ta-agent/base-tool';
import { createPiFauxRuntime } from '@ta-agent/model-invocation-pi';

it('forwards Pi loop cancellation to a tool with an independent runtime owner', async () => {
  const owner = new AbortController();
  const loop = new AbortController();
  const started = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  const tools = createBoundedToolRuntime({
    signal: owner.signal,
    executionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
    permissionPolicy: defineToolPermissionPolicy({
      responsibility: ['work'],
      actor: ['work'],
      product: ['work'],
      runtime: ['work'],
    }),
    registry: createToolRegistry([
      defineTool({
        name: 'work',
        description: 'Cancellable work.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        execute: async ({ signal }) => {
          started.resolve(signal);
          await release.promise;
          signal.throwIfAborted();
          return { text: 'done' };
        },
      }),
    ]),
  });
  const profile = createPiFauxRuntime({
    responses: [
      { status: 'tool-call', callId: 'work-1', name: 'work', arguments: {} },
      { status: 'success', text: 'unreachable' },
    ],
  });
  const run = profile.runtime.run({
    target: await profile.runtime.resolveTarget(profile.modelReference),
    instructions: '',
    history: [],
    prompt: { role: 'user', text: 'work', timestamp: 1 },
    tools,
    signal: loop.signal,
    maxModelTurns: 2,
    maxOutputCharacters: 100,
    emit: () => Promise.resolve(),
  });
  const observed = run.catch(() => undefined);
  try {
    const toolSignal = await started.promise;
    loop.abort(new Error('stop loop'));
    expect(toolSignal.aborted).toBe(true);
    expect(toolSignal.reason).toBe(loop.signal.reason);
    expect(owner.signal.aborted).toBe(false);
    release.resolve();
    await expect(run).rejects.toMatchObject({ code: 'TOOL_EXECUTION_CANCELLED' });
    expect(profile.inspect().callCount).toBe(1);
  } finally {
    release.resolve();
    await observed;
    tools.close();
  }
});
