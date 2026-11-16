import { MemoryOutputSink, MemorySessionAdapter } from '@print-an-agent/base-local-adapters';
import {
  REQUEST_WORKFLOW_NAME,
  type DefaultRequestWorkflowContext,
} from '@print-an-agent/base-request';
import { expect, it, vi } from 'vitest';
import { FOREGROUND_AGENT_OPERATION_NAME } from '../../src/index.js';
import {
  defaultRequestStep,
  interactionAgent,
  interactionMessage,
} from '../support/interaction-agent.js';

it('shares prepared Request capabilities while isolating concurrent cancellation, sinks, Tools, leases and tracing', async () => {
  const caller = new AbortController();
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const session = new MemorySessionAdapter();
  const released = vi.spyOn(session, 'releaseSessionExecution');
  const contexts: DefaultRequestWorkflowContext[] = [];
  // Interaction and failure cleanup can both call idempotent close; track the owning Run.
  const closedTools = new Set<string>();
  const generatedSinks: MemoryOutputSink[] = [];
  let nextRun = 0;
  const fixture = await interactionAgent(
    async (request) => {
      if (request.prompt.text === 'start') {
        firstStarted.resolve();
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true })
        );
        throw request.signal.reason;
      }
      secondStarted.resolve();
      await release.promise;
      const message = interactionMessage(request.prompt.text);
      await request.emit({ type: 'text-delta', delta: message.text });
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    },
    {
      session,
      createRunId: () => `request-${++nextRun}`,
      createOutputSink: () => {
        const sink = new MemoryOutputSink();
        generatedSinks.push(sink);
        return sink;
      },
      stepOverrides: {
        buildTools: async (context) => {
          await defaultRequestStep('buildTools')(context);
          contexts.push(context);
          const tools = context.state.tools;
          if (tools === undefined) throw new Error('Tools were not created.');
          const close = tools.close.bind(tools);
          vi.spyOn(tools, 'close').mockImplementation(() => {
            closedTools.add(context.state.agentRun.runId);
            close();
          });
        },
      },
    }
  );
  const cancelled = fixture.run(caller.signal).catch((error: unknown) => error);
  const survivor = fixture.agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, { message: 'survivor' });
  const observedSurvivor = survivor.catch(() => undefined);
  try {
    await Promise.all([firstStarted.promise, secondStarted.promise]);
    expect(contexts).toHaveLength(2);
    const first = contexts.find((context) => context.state.agentRun.runId === 'request-1');
    const second = contexts.find((context) => context.state.agentRun.runId === 'request-2');
    if (first === undefined || second === undefined) throw new Error('Missing Request contexts.');
    expect(first.resources).toBe(second.resources);
    expect(first.resources.session).toBe(session);
    expect(first.resources.policy).toBe(fixture.agent.operations.foreground.config);
    expect(first.state).not.toBe(second.state);
    expect(first.state.tools).not.toBe(second.state.tools);
    expect(first.state.session?.execution).toBeDefined();
    expect(first.state.session?.execution).not.toBe(second.state.session?.execution);
    expect(first.state.agentRun.traceEmitter).not.toBe(second.state.agentRun.traceEmitter);
    expect(first.state.request?.outputSink).toBe(fixture.output);
    expect(second.state.request?.outputSink).toBe(generatedSinks[0]);

    caller.abort();
    expect(await cancelled).toBeInstanceOf(Error);
    expect(fixture.output.inspect().status).toBe('failed');
    expect(generatedSinks[0]?.inspect().status).toBe('open');
    expect(second.signal.aborted).toBe(false);
    expect([...closedTools]).toEqual(['request-1']);
    expect(released).toHaveBeenCalledTimes(1);

    release.resolve();
    const response = await survivor;
    expect(response.message.text).toBe('survivor');
    expect(generatedSinks[0]?.inspect().status).toBe('closed');
    expect([...closedTools]).toEqual(['request-1', 'request-2']);
    expect(released).toHaveBeenCalledTimes(2);

    await expect(
      fixture.agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
        sessionId: response.sessionId,
        message: 'later',
      })
    ).resolves.toMatchObject({ message: { text: 'later' } });
    expect(generatedSinks).toHaveLength(2);
    expect(generatedSinks[1]?.inspect().status).toBe('closed');
    expect(contexts.every((context) => context.resources === first.resources)).toBe(true);
    expect(released).toHaveBeenCalledTimes(3);
    const snapshot = await session.inspect({
      agentId: fixture.agent.identity.id,
      sessionId: response.sessionId,
    });
    expect(snapshot?.turns).toHaveLength(2);
    expect(snapshot?.turns.every((turn) => turn.status === 'completed')).toBe(true);
    for (const context of contexts) {
      const starts = fixture.trace
        .inspect({ agentRunId: context.state.agentRun.runId })
        .events.filter((event) => event.type === 'workflow-run-started');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toMatchObject({
        agentRunId: context.state.agentRun.runId,
        workflowName: REQUEST_WORKFLOW_NAME,
      });
    }
  } finally {
    caller.abort();
    release.resolve();
    await Promise.allSettled([cancelled, observedSurvivor]);
  }
});
