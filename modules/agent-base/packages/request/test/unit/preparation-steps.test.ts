import { describe, expect, it } from 'vitest';
import type { Step } from '@print-an-agent/workflow-core';
import {
  resolveRequestInstructions,
  type InstructionsStepContext,
} from '../../src/preparation/index.js';
import {
  buildInteractionRequest,
  type InteractionRequestContext,
} from '../../src/preparation/index.js';
import { validateRequestMessage } from '../../src/preparation/message.js';
import {
  deliverReasoningDelta,
  deliverTextDelta,
  type DeltaDeliveryContext,
} from '../../src/output/index.js';

describe('narrow request Steps', () => {
  it('shares the same instruction Step across independent minimum Contexts', async () => {
    interface WebsiteContext extends InstructionsStepContext<{ message: string }> {
      readonly page: string;
    }
    interface ReportContext extends InstructionsStepContext<{ title: string }> {
      readonly format: 'report';
    }
    const websiteStep: Step<WebsiteContext> = resolveRequestInstructions;
    const reportStep: Step<ReportContext> = resolveRequestInstructions;
    const website: WebsiteContext = {
      page: 'home',
      state: { request: { message: 'hello' } },
      resources: {
        instructionContributors: [({ request }) => ` ${request.message} `, () => '', () => 'world'],
        policy: { maxInstructionsCharacters: 100 },
      },
    };
    const report: ReportContext = {
      format: 'report',
      state: { request: { title: 'Report' } },
      resources: {
        instructionContributors: [({ request }) => request.title],
        policy: { maxInstructionsCharacters: 100 },
      },
    };
    expect(websiteStep).toBe(reportStep);
    await Promise.all([websiteStep(website), reportStep(report)]);
    expect(website.state.instructions).toBe('hello\n\nworld');
    expect(report.state.instructions).toBe('Report');
  });

  it('preserves instruction budgets and contributor failures', async () => {
    const context: InstructionsStepContext<string> = {
      state: { request: 'input' },
      resources: {
        instructionContributors: [() => 'too long'],
        policy: { maxInstructionsCharacters: 2 },
      },
    };
    await expect(resolveRequestInstructions(context)).rejects.toMatchObject({
      code: 'REQUEST_INSTRUCTIONS_INVALID',
    });
    const failure = new Error('contributor');
    await expect(
      resolveRequestInstructions({
        ...context,
        resources: {
          ...context.resources,
          instructionContributors: [
            () => {
              throw failure;
            },
          ],
        },
      })
    ).rejects.toBe(failure);
    expect(context.state.instructions).toBeUndefined();
  });

  it('keeps message whitespace and rejects empty or oversized messages', () => {
    expect(validateRequestMessage(' hi ', 4)).toBe(' hi ');
    for (const value of ['', '  ', null, '12345']) {
      expect(() => validateRequestMessage(value, 4)).toThrow('Request message must contain');
    }
  });

  it('assembles an interaction request without acquiring history or tools', async () => {
    const history = Object.freeze([{ role: 'context' as const, text: 'facts', timestamp: 0 }]);
    const tools = { tools: [], execute: () => Promise.reject(new Error('unused')) };
    const signal = new AbortController().signal;
    const events: unknown[] = [];
    const context: InteractionRequestContext = {
      signal,
      state: {
        instructions: 'instructions',
        history,
        userMessage: { role: 'user', text: 'hello', timestamp: 1 },
        tools,
      },
      resources: { policy: { maxModelTurns: 2, maxOutputCharacters: 100 } },
    };
    await buildInteractionRequest(context);
    expect(context.state.modelRequest?.history).toBe(history);
    expect(context.state.modelRequest?.tools).toBe(tools);
    context.state.interaction = {
      emit: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
    await context.state.modelRequest?.emit({ type: 'turn-start' });
    expect(events).toEqual([{ type: 'turn-start' }]);
    expect(context.state.modelRequest?.signal).toBe(signal);
  });

  it('delivers only typed deltas through a Session-free writer and preserves backpressure', async () => {
    const events: unknown[] = [];
    const context: DeltaDeliveryContext = {
      state: {
        interaction: { currentEvent: { type: 'reasoning-delta', delta: 'thinking' } },
        request: {
          outputSink: {
            write: async (event) => {
              await Promise.resolve();
              events.push(event);
            },
          },
        },
      },
    };
    await deliverReasoningDelta(context);
    expect(events).toEqual([{ type: 'reasoning-delta', delta: 'thinking' }]);
    await expect(deliverTextDelta(context)).rejects.toMatchObject({
      code: 'REQUEST_INTERACTION_EVENT_INVALID',
    });
    const cause = new Error('sink');
    await expect(
      deliverReasoningDelta({
        state: {
          ...context.state,
          request: { outputSink: { write: () => Promise.reject(cause) } },
        },
      })
    ).rejects.toMatchObject({ code: 'REQUEST_OUTPUT_FAILED', cause });
  });
});
