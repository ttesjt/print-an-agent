import {
  createActor,
  requireCompletionCapability,
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import {
  createCompletionMemoryPlanner,
  createModelMemoryResources,
  createContextMemoryBundle,
  MemoryMeter,
  type MemoryPlannerRequest,
  type ModelEditOperation,
  type ModelMemoryResourceOptions,
  type ModelMemoryWorkflowDefinitions,
  type CompletionMemoryPlannerOptions,
  type MemoryStore,
} from '@print-an-agent/context-memory';

/** Exact for this test vocabulary only; not a tokenizer recommendation for real models. */
export function vocabularyCounter(ref = 'qualification:codepoints:v1', multiplier = 1) {
  return createTokenCounter({
    measurementRef: ref,
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input) =>
      Promise.resolve({ tokens: Array.from(input.text).length * multiplier, accuracy: 'exact' }),
  });
}
export type Plan = (
  request: MemoryPlannerRequest,
  signal: AbortSignal
) => readonly ModelEditOperation[] | Promise<readonly ModelEditOperation[]>;

export function plannerActor(plan: Plan) {
  const requests: MemoryPlannerRequest[] = [];
  const instructions: string[] = [];
  let active = 0;
  const completion = requireCompletionCapability(
    createActor({
      id: 'independent-memory-consumer',
      engine: {
        id: 'qualification-model',
        capabilities: {
          invocationModes: ['direct'],
          inputMediaTypes: ['text'],
          cancellation: true,
          structuredOutput: false,
          toolCalling: false,
        },
        complete: async (request) => {
          const text = request.messages[0]?.text;
          if (text === undefined) throw new Error('Missing reference payload.');
          const payload = JSON.parse(text) as MemoryPlannerRequest;
          requests.push(payload);
          instructions.push(request.instructions);
          active++;
          try {
            const operations = await plan(payload, request.signal);
            return {
              message: defineAssistantModelMessage({
                role: 'assistant',
                text: JSON.stringify(operations),
                provenance: defineProviderModelExecutionProvenance({
                  provider: 'qualification',
                  model: 'deterministic',
                }),
                stopReason: 'stop',
                timestamp: 0,
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  totalTokens: 0,
                },
              }),
            };
          } finally {
            active--;
          }
        },
      },
    })
  );
  return {
    completion,
    requests,
    instructions,
    get active() {
      return active;
    },
  };
}
export function consumer(
  store: MemoryStore,
  plan: Plan = () => [],
  options: {
    resources?: Partial<Omit<ModelMemoryResourceOptions, 'store' | 'planner'>>;
    workflows?: Partial<ModelMemoryWorkflowDefinitions>;
    instructions?: CompletionMemoryPlannerOptions['instructions'];
  } = {}
) {
  const actor = plannerActor(plan);
  const counter = vocabularyCounter();
  const resources = createModelMemoryResources({
    meter: new MemoryMeter({ counter }),
    defaults: { measurementRef: counter.descriptor.measurementRef },
    ...options.resources,
    store,
    planner: createCompletionMemoryPlanner({
      completion: actor.completion,
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    }),
  });
  return {
    actor,
    resources,
    bundle: createContextMemoryBundle({
      resources,
      ...(options.workflows === undefined ? {} : { workflows: options.workflows }),
    }),
  };
}
