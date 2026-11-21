import type { ActorDirectResult } from '@print-an-agent/model-invocation-core';
import { RUN_WORKFLOW } from '@print-an-agent/workflow-core';
import { expectTypeOf } from 'vitest';
import {
  createRequestWorkflow,
  createSessionlessRequestWorkflow,
  type RequestWorkflowStateView,
  type SessionlessGenerationWorkflowOptions,
  type SessionlessInteractionResponse,
  type SessionlessInteractionWorkflowOptions,
  type SessionlessRequestStepName,
  type SESSIONLESS_REQUEST_STEP_NAMES,
} from '../../src/index.js';

expectTypeOf<
  (typeof SESSIONLESS_REQUEST_STEP_NAMES)[number]
>().toEqualTypeOf<SessionlessRequestStepName>();

interface Input {
  readonly message: string;
}
interface State extends RequestWorkflowStateView<string> {
  readonly input: Input;
}

export function customRequestWorkflow() {
  const resources = { marker: 'custom', record: (_value: number): void => undefined };
  return createRequestWorkflow<Input, State, typeof resources, string>({
    resources,
    createState: ({ input }) => ({ input }),
    condition: ({ resources }) => {
      expectTypeOf(resources.marker).toEqualTypeOf<string>();
      return RUN_WORKFLOW;
    },
    stepOverrides: {
      validateRequest: ({ resources }) => {
        resources.record(1);
        return Promise.resolve();
      },
    },
    executeStep: async ({ context, step }) => {
      expectTypeOf(context.state.input).toEqualTypeOf<Input>();
      context.resources.record(2);
      await step(context);
    },
    lifecycle: {
      onFinally: ({ resources }) => {
        resources.record(3);
        return Promise.resolve();
      },
    },
  });
}

export async function generationResult(options: SessionlessGenerationWorkflowOptions) {
  const result = await createSessionlessRequestWorkflow(options).run({
    input: { message: 'hello' },
  });
  expectTypeOf(result).toEqualTypeOf<ActorDirectResult | undefined>();
}

export async function interactionResult(options: SessionlessInteractionWorkflowOptions) {
  const result = await createSessionlessRequestWorkflow(options).run({
    input: { message: 'hello' },
  });
  expectTypeOf(result).toEqualTypeOf<SessionlessInteractionResponse | undefined>();
}
