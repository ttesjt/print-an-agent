import type { AgentTraceEvent, AgentTraceEventSink } from '@print-an-agent/base-observability';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect } from 'vitest';
import type { AgentDefinitionError, BaseAgentRunContext } from '../../src/index.js';
import { bindAgentWorkflow, type AgentWorkflow } from '../../src/index.js';

export type StepName = 'execute';

export interface TextRunContext extends BaseAgentRunContext<string, string> {
  readonly values: string[];
}

export class RecordingTraceSink implements AgentTraceEventSink {
  readonly events: AgentTraceEvent[] = [];

  record(event: AgentTraceEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export function textWorkflow(name: string, prefix: string): AgentWorkflow<TextRunContext, string> {
  return bindAgentWorkflow({
    projectInput: (context: TextRunContext) => context,
    workflow: new Workflow<
      StepName,
      TextRunContext,
      { readonly input: TextRunContext; output: string },
      undefined,
      string
    >({
      name,
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            context.state.output = `${prefix}:${context.state.input.input}`;
            return Promise.resolve();
          },
        },
      },
      createState: ({ input }) => ({ input, output: '' }),
      createResult: ({ output }) => output,
    }),
    applyResult: (context, result) => {
      context.values.push(result);
      context.output = context.values.join('|');
      return Promise.resolve();
    },
  });
}

export type NumberRunContext = BaseAgentRunContext<number, number>;

export function numberWorkflow(name: string): AgentWorkflow<NumberRunContext, number> {
  return bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<
      StepName,
      NumberRunContext,
      { readonly input: NumberRunContext; output: number },
      undefined,
      number
    >({
      name,
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            context.state.output = context.state.input.input * 2;
            return Promise.resolve();
          },
        },
      },
      createState: ({ input }) => ({ input, output: 0 }),
      createResult: ({ output }) => output,
    }),
    applyResult: (context, result) => {
      context.output = result;
      return Promise.resolve();
    },
  });
}

export function expectDefinitionError(
  run: () => unknown,
  code: AgentDefinitionError['code']
): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected AgentDefinitionError with code ${code}.`);
}

export function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Run cancelled.', { cause: signal.reason });
}
