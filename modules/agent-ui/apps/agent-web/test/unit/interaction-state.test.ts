import type {
  CompletedConversationTurn,
  ConversationInteractionEvent,
  ConversationSessionAdmission,
  ConversationToolActivity,
} from '@print-an-agent/ui-contracts';
import { describe, expect, it } from 'vitest';
import { interactionEvent } from '../../src/transport/schemas.js';

import {
  ConversationStreamProtocolError,
  createSubmittingInteraction,
  interactionAssistantText,
  interactionReasoningBlocks,
  reduceInteractionEvent,
} from '@print-an-agent/ui-workspace/testing';

describe('conversation interaction reducer', () => {
  it('decodes admission through a closed, validated transport record', () => {
    const event = {
      type: 'session-admitted',
      interactionId: 'admission',
      admission: sessionAdmission(),
    };
    expect(interactionEvent.decode(event)).toEqual(event);
    expect(() => interactionEvent.decode({ ...event, unexpected: true })).toThrow();
    expect(() =>
      interactionEvent.decode({ ...event, admission: { ...event.admission, unexpected: true } })
    ).toThrow();
    expect(() =>
      interactionEvent.decode({
        ...event,
        admission: { ...event.admission, details: { ...event.admission.details, turnCount: -1 } },
      })
    ).toThrow();
  });

  it('accepts one consistent Session admission before model output', () => {
    const submitting = createSubmittingInteraction({
      interactionId: 'admission',
      message: 'Question',
      timestamp: '2026-02-01T00:00:00.000Z',
    });
    const admission = sessionAdmission();
    const event: ConversationInteractionEvent = {
      type: 'session-admitted',
      interactionId: 'admission',
      admission,
    };
    expect(() => reduceInteractionEvent(submitting, event)).toThrow(
      ConversationStreamProtocolError
    );
    const started = reduceInteractionEvent(submitting, {
      type: 'interaction-started',
      interactionId: 'admission',
    });
    const admitted = reduceInteractionEvent(started, event);
    expect(admitted.admission).toBe(admission);
    expect(() => reduceInteractionEvent(admitted, event)).toThrow(
      'Session admission is inconsistent or out of order.'
    );
    const content = reduceInteractionEvent(started, {
      type: 'text-delta',
      delta: 'Answer',
      modelTurnIndex: 1,
      interactionId: 'admission',
    });
    expect(() => reduceInteractionEvent(content, event)).toThrow(
      'Session admission is inconsistent or out of order.'
    );
    expect(() =>
      reduceInteractionEvent(admitted, {
        type: 'completed',
        interactionId: 'admission',
        sessionId: 'other-session',
        turn: completedTurn(),
      })
    ).toThrow('Completed interaction does not match its admitted Session.');
    expect(() =>
      reduceInteractionEvent(admitted, {
        type: 'completed',
        interactionId: 'admission',
        sessionId: 'session-1',
        turn: { ...completedTurn(), branchId: 'other-branch' },
      })
    ).toThrow('Completed interaction does not match its admitted Session.');
  });

  it.each([
    { details: { status: 'retired' as const, retiredAt: '2026-02-01T00:00:00.000Z' } },
    { details: { agentId: 'different-agent' } },
    { details: { sessionId: 'different-session' } },
    { details: { navigationRevision: 'different-revision' } },
    { details: { selectedBranchId: 'different-branch' } },
    { details: { branchCount: 2 } },
    { navigation: { branches: [] } },
  ])('rejects inconsistent admission metadata: %j', (patch) => {
    const admission = sessionAdmission();
    const started = reduceInteractionEvent(
      createSubmittingInteraction({
        interactionId: 'admission',
        message: 'Question',
        timestamp: '2026-02-01T00:00:00.000Z',
      }),
      { type: 'interaction-started', interactionId: 'admission' }
    );
    expect(() =>
      reduceInteractionEvent(started, {
        type: 'session-admitted',
        interactionId: 'admission',
        admission: {
          details: { ...admission.details, ...patch.details },
          navigation: { ...admission.navigation, ...patch.navigation },
        },
      })
    ).toThrow('Session admission is inconsistent or out of order.');
  });

  it('preserves model-turn reasoning boundaries and safe tool lifecycle presentation', () => {
    const interactionId = 'interaction-1';
    const pendingTool = tool('pending');
    const completedTool = Object.freeze({
      ...pendingTool,
      details: Object.freeze([Object.freeze({ label: 'Matches', value: '2' })]),
      status: 'success' as const,
      summary: 'Found two safe records.',
    });
    const events: readonly ConversationInteractionEvent[] = [
      { interactionId, type: 'interaction-started' },
      { delta: 'Before ', interactionId, modelTurnIndex: 1, type: 'reasoning-delta' },
      { delta: 'tool', interactionId, modelTurnIndex: 1, type: 'reasoning-delta' },
      { activity: pendingTool, interactionId, type: 'tool-activity-updated' },
      { activity: completedTool, interactionId, type: 'tool-activity-updated' },
      { delta: 'After tool', interactionId, modelTurnIndex: 2, type: 'reasoning-delta' },
      { delta: 'Final ', interactionId, modelTurnIndex: 2, type: 'text-delta' },
      { delta: 'answer', interactionId, modelTurnIndex: 2, type: 'text-delta' },
    ];
    let state = createSubmittingInteraction({
      interactionId,
      message: 'Use a tool',
      timestamp: '2026-02-01T00:00:00.000Z',
    });
    for (const event of events) state = reduceInteractionEvent(state, event);

    expect(interactionReasoningBlocks(state)).toEqual([
      { modelTurnIndex: 1, text: 'Before tool' },
      { modelTurnIndex: 2, text: 'After tool' },
    ]);
    expect(interactionAssistantText(state)).toBe('Final answer');
    expect(state.toolActivities).toEqual([completedTool]);

    const turn = completedTurn(completedTool);
    state = reduceInteractionEvent(state, {
      interactionId,
      sessionId: 'session-1',
      turn,
      type: 'completed',
    });
    expect(state).toMatchObject({ sessionId: 'session-1', status: 'completed', turn });
  });

  it('rejects missing start, duplicate start, invalid tool transitions, and post-terminal events', () => {
    const interactionId = 'interaction-2';
    const submitting = createSubmittingInteraction({
      interactionId,
      message: 'Question',
      timestamp: '2026-02-01T00:00:00.000Z',
    });
    expect(() =>
      reduceInteractionEvent(submitting, {
        delta: 'late',
        interactionId,
        modelTurnIndex: 1,
        type: 'text-delta',
      })
    ).toThrow(ConversationStreamProtocolError);

    const streaming = reduceInteractionEvent(submitting, {
      interactionId,
      type: 'interaction-started',
    });
    expect(() =>
      reduceInteractionEvent(streaming, { interactionId, type: 'interaction-started' })
    ).toThrow('Interaction started more than once.');
    expect(() =>
      reduceInteractionEvent(streaming, {
        interactionId,
        type: 'unknown-event',
      } as never)
    ).toThrow('Interaction event type is not supported.');
    expect(() =>
      reduceInteractionEvent(streaming, {
        activity: tool('success'),
        interactionId,
        type: 'tool-activity-updated',
      })
    ).toThrow('Tool activity must begin in the pending state.');

    const failed = reduceInteractionEvent(streaming, {
      failure: { code: 'interaction-failed', message: 'Stopped.' },
      interactionId,
      type: 'failed',
    });
    expect(() =>
      reduceInteractionEvent(failed, {
        delta: 'late',
        interactionId,
        modelTurnIndex: 1,
        type: 'reasoning-delta',
      })
    ).toThrow('Interaction event arrived after the terminal event.');
  });

  it('rejects a canonical completed turn that differs from accepted streaming presentation', () => {
    const interactionId = 'interaction-3';
    let state = createSubmittingInteraction({
      interactionId,
      message: 'Question',
      timestamp: '2026-02-01T00:00:00.000Z',
    });
    state = reduceInteractionEvent(state, { interactionId, type: 'interaction-started' });
    state = reduceInteractionEvent(state, {
      delta: 'Visible answer',
      interactionId,
      modelTurnIndex: 1,
      type: 'text-delta',
    });

    expect(() =>
      reduceInteractionEvent(state, {
        interactionId,
        sessionId: 'session-1',
        turn: Object.freeze({
          ...completedTurn(),
          assistantMessage: Object.freeze({
            ...completedTurn().assistantMessage,
            text: 'Different answer',
          }),
        }),
        type: 'completed',
      })
    ).toThrow('Completed interaction does not match the accepted stream presentation.');
  });
});

function sessionAdmission(): ConversationSessionAdmission {
  const timestamp = '2026-02-01T00:00:00.000Z';
  return {
    details: {
      agentId: 'agent-a',
      branchCount: 1,
      createdAt: timestamp,
      metadataRevision: 'metadata-1',
      navigationRevision: 'navigation-1',
      selectedBranchId: 'main',
      sessionId: 'session-1',
      status: 'active',
      turnCount: 1,
      updatedAt: timestamp,
    },
    navigation: {
      agentId: 'agent-a',
      branches: [{ branchId: 'main', createdAt: timestamp }],
      revision: 'navigation-1',
      selectedBranchId: 'main',
      sessionId: 'session-1',
    },
  };
}

function tool(status: ConversationToolActivity['status']): ConversationToolActivity {
  return Object.freeze({
    callId: 'tool-1',
    details: Object.freeze([]),
    modelTurnIndex: 1,
    status,
    toolLabel: 'Evidence lookup',
  });
}

function completedTurn(toolActivity?: ConversationToolActivity): CompletedConversationTurn {
  return Object.freeze({
    assistantMessage: Object.freeze({
      reasoningBlocks: Object.freeze([
        Object.freeze({ modelTurnIndex: 1, text: 'Before tool' }),
        Object.freeze({ modelTurnIndex: 2, text: 'After tool' }),
      ]),
      text: 'Final answer',
      timestamp: '2026-02-01T00:00:01.000Z',
      toolActivities: Object.freeze(toolActivity === undefined ? [] : [toolActivity]),
    }),
    branchId: 'main',
    status: 'completed',
    turnId: 'turn-1',
    userMessage: Object.freeze({
      text: 'Use a tool',
      timestamp: '2026-02-01T00:00:00.000Z',
    }),
  });
}
