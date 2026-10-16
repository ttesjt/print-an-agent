import { MemoryOutputSink, MemorySessionAdapter } from '@ta-agent/base-local-adapters';
import type { ActorInteractionRequest } from '@ta-agent/base-actor';
import {
  AgentSessionError,
  MAX_SESSION_PRESENTATION_CHARACTERS,
  parseSessionId,
  parseTurnId,
  type NavigableCompactableSessionPort,
  type SessionExecutionPort,
} from '@ta-agent/base-session';
import {
  requireInteractionEvent,
  DEFAULT_REQUEST_POLICY,
  type DefaultRequestWorkflowContext,
} from '@ta-agent/base-request';
import { SKIP_STEP } from '@ta-agent/workflow-core';
import { describe, expect, it, vi } from 'vitest';
import { FOREGROUND_AGENT_OPERATION_NAME } from '../../src/index.js';
import { interactionAgent, interactionMessage } from '../support/interaction-agent.js';

function reference(fixture: Awaited<ReturnType<typeof interactionAgent>>) {
  return {
    agentId: fixture.agent.identity.id,
    sessionId: parseSessionId('session'),
    turnId: parseTurnId('interaction-run'),
  };
}

describe('Reasoning presentation composition', () => {
  it.each(['capture', 'build'] as const)(
    'bounds %s overrides before atomic commit',
    async (stage) => {
      const oversized = 'x'.repeat(MAX_SESSION_PRESENTATION_CHARACTERS + 1);
      const fixture = await interactionAgent(
        async (request) => {
          await request.emit({ type: 'reasoning-delta', delta: 'small input' });
          const message = interactionMessage();
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
        {
          requestPolicy: {
            ...DEFAULT_REQUEST_POLICY,
            maxReasoningCharacters: MAX_SESSION_PRESENTATION_CHARACTERS * 2,
          },
          stepOverrides:
            stage === 'capture'
              ? {
                  captureReasoningPresentation: (context) => {
                    context.state.capturedReasoning = {
                      blocks: [{ modelTurnIndex: 1, chunks: [oversized] }],
                      characterCount: oversized.length,
                    };
                    return Promise.resolve();
                  },
                }
              : {
                  buildTurnPresentation: (context) => {
                    context.state.turnPresentation = {
                      reasoningBlocks: [{ modelTurnIndex: 1, text: oversized }],
                    };
                    return Promise.resolve();
                  },
                },
        }
      );
      await expect(fixture.run()).rejects.toMatchObject({
        code: 'SESSION_PRESENTATION_LIMIT_EXCEEDED',
      });
      expect(await fixture.session.readTurnPresentation(reference(fixture))).toBeUndefined();
      expect(fixture.output.inspect()).toMatchObject({
        failure: { code: 'SESSION_PRESENTATION_LIMIT_EXCEEDED' },
      });
    }
  );
  it.each(['default', 'skip-capture', 'skip-delivery', 'redact', 'skip-build'] as const)(
    'uses independent registered capture and delivery Steps: %s',
    async (mode) => {
      let savedContext: DefaultRequestWorkflowContext | undefined;
      const fixture = await interactionAgent(
        async (request) => {
          for (const delta of ['first', 'second'])
            await request.emit({ type: 'reasoning-delta', delta });
          const message = interactionMessage();
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
        {
          stepOverrides: {
            ...(mode === 'skip-capture'
              ? { captureReasoningPresentation: { step: SKIP_STEP } }
              : {}),
            ...(mode === 'skip-delivery' ? { deliverReasoningDelta: SKIP_STEP } : {}),
            ...(mode === 'skip-build' ? { buildTurnPresentation: SKIP_STEP } : {}),
            ...(mode === 'redact'
              ? {
                  captureReasoningPresentation: (context: DefaultRequestWorkflowContext) => {
                    savedContext = context;
                    const { delta } = requireInteractionEvent(context, 'reasoning-delta');
                    const text = delta.replace(/first|second/g, '[redacted]');
                    const captured = context.state.capturedReasoning ?? {
                      blocks: [{ modelTurnIndex: 1, chunks: [] }],
                      characterCount: 0,
                    };
                    captured.blocks[0]?.chunks.push(text);
                    captured.characterCount += text.length;
                    context.state.capturedReasoning = captured;
                    return Promise.resolve();
                  },
                }
              : {}),
          },
        }
      );
      const response = await fixture.run();
      const record = await fixture.session.readTurnPresentation(reference(fixture));
      if (mode === 'skip-capture' || mode === 'skip-build') expect(record).toBeUndefined();
      else
        expect(record?.presentation.reasoningBlocks).toEqual([
          { modelTurnIndex: 1, text: mode === 'redact' ? '[redacted][redacted]' : 'firstsecond' },
        ]);
      const reasons = fixture.output
        .inspect()
        .events.filter((event) => event.type === 'reasoning-delta');
      expect(reasons).toHaveLength(mode === 'skip-delivery' ? 0 : 2);
      expect(JSON.stringify(response)).not.toContain('firstsecond');
      if (savedContext !== undefined) {
        expect(savedContext.state.capturedReasoning).toBeUndefined();
        expect(savedContext.state.turnPresentation).toBeUndefined();
      }
      expect(JSON.stringify(fixture.trace.inspect())).not.toContain('[redacted]');
      const replay = new MemoryOutputSink();
      await fixture.agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
        message: 'start',
        sessionId: 'session',
        idempotencyKey: 'request',
        outputSink: replay,
      });
      expect(replay.inspect().events).toEqual([{ type: 'text-delta', delta: 'AB' }]);
      expect(await fixture.session.readTurnPresentation(reference(fixture))).toEqual(record);
    }
  );

  it.each(['cancel', 'engine-failure', 'protocol-failure', 'storage-failure'] as const)(
    'discards partial presentation on %s and preserves the failure identity',
    async (mode) => {
      const controller = new AbortController();
      const fixture = await interactionAgent(async (request) => {
        await request.emit({ type: 'reasoning-delta', delta: 'partial' });
        if (mode === 'engine-failure') throw new Error('engine failed');
        if (mode === 'cancel') controller.abort();
        const message = interactionMessage();
        await request.emit({ type: 'assistant-complete', message });
        if (mode === 'protocol-failure')
          await request.emit({ type: 'reasoning-delta', delta: 'late' });
        return { message };
      });
      if (mode === 'storage-failure')
        vi.spyOn(fixture.session, 'completeTurnWithPresentation').mockRejectedValue(
          new AgentSessionError('SESSION_STORAGE_FAILED', 'fixture failure')
        );
      await expect(fixture.run(controller.signal)).rejects.toBeDefined();
      expect(await fixture.session.readTurnPresentation(reference(fixture))).toBeUndefined();
      expect((await fixture.session.inspect(reference(fixture)))?.turns[0]?.status).toBe('failed');
      if (mode === 'storage-failure')
        expect(fixture.output.inspect()).toMatchObject({
          failure: { code: 'SESSION_STORAGE_FAILED' },
        });
    }
  );

  it('keeps a committed presentation if subsequent output close fails', async () => {
    const fixture = await interactionAgent(async (request) => {
      await request.emit({ type: 'reasoning-delta', delta: 'complete reason' });
      const message = interactionMessage();
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    });
    vi.spyOn(fixture.output, 'close').mockRejectedValue(new Error('close failed'));
    await expect(fixture.run()).rejects.toMatchObject({ code: 'REQUEST_OUTPUT_FAILED' });
    expect((await fixture.session.inspect(reference(fixture)))?.turns[0]?.status).toBe('completed');
    expect(
      (await fixture.session.readTurnPresentation(reference(fixture)))?.presentation.reasoningBlocks
    ).toEqual([{ modelTurnIndex: 1, text: 'complete reason' }]);
  });

  it('creates no empty presentation when the Engine emits none', async () => {
    const fixture = await interactionAgent(async (request) => {
      const message = interactionMessage();
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    });
    const commit = vi.spyOn(fixture.session, 'completeTurnWithPresentation');
    await fixture.run();
    expect(commit).not.toHaveBeenCalled();
    expect(await fixture.session.readTurnPresentation(reference(fixture))).toBeUndefined();
  });

  it('fails before invocation for an unsupported adapter unless capture is explicitly skipped', async () => {
    const backing = new MemorySessionAdapter();
    const session: NavigableCompactableSessionPort & SessionExecutionPort = {
      acquireSessionExecution: backing.acquireSessionExecution.bind(backing),
      releaseSessionExecution: backing.releaseSessionExecution.bind(backing),
      resolve: backing.resolve.bind(backing),
      beginTurn: backing.beginTurn.bind(backing),
      completeTurn: backing.completeTurn.bind(backing),
      failTurn: backing.failTurn.bind(backing),
      loadHistory: backing.loadHistory.bind(backing),
      loadContext: backing.loadContext.bind(backing),
      inspect: backing.inspect.bind(backing),
      readCompaction: backing.readCompaction.bind(backing),
      commitCompaction: backing.commitCompaction.bind(backing),
      applyNavigation: backing.applyNavigation.bind(backing),
    };
    const engine = vi.fn(async (request: ActorInteractionRequest) => {
      await request.emit({ type: 'reasoning-delta', delta: 'not saved' });
      const message = interactionMessage();
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    });
    await expect(
      Promise.resolve().then(() => interactionAgent(engine, { session }))
    ).rejects.toMatchObject({ code: 'SESSION_PRESENTATION_NOT_CONFIGURED' });
    expect(engine).not.toHaveBeenCalled();
    const fixture = await interactionAgent(engine, {
      session,
      stepOverrides: { captureReasoningPresentation: { step: SKIP_STEP } },
    });
    await fixture.run();
    expect(engine).toHaveBeenCalledTimes(1);
  });
});
