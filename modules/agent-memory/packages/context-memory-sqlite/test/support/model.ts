import {
  createActor,
  requireCompletionCapability,
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
} from '@print-an-agent/model-invocation-core';
import {
  createContextMemoryBundle,
  createModelMemoryResources,
  createCompletionMemoryPlanner,
  type MemoryPlannerRequest,
  type ModelEditOperation,
  type MemoryConfigInput,
  type ExecutionPolicy,
  type ModelMemoryWorkflowDefinitions,
  type CompletionMemoryPlannerOptions,
} from '@print-an-agent/context-memory';
import { borrowed } from './fixtures.js';

type Output = string | readonly ModelEditOperation[];
export type Plan = (
  request: MemoryPlannerRequest,
  call: number,
  signal: AbortSignal
) => Output | Promise<Output>;
export function modelFixture(
  plan: Plan,
  options: {
    defaults?: MemoryConfigInput;
    policy?: Partial<ExecutionPolicy>;
    workflows?: Partial<ModelMemoryWorkflowDefinitions>;
    instructions?: CompletionMemoryPlannerOptions['instructions'];
    stopReason?: 'stop' | 'length';
    maxOutputCharacters?: number;
    actorTimeoutMs?: number;
  } = {}
) {
  const base = borrowed();
  const requests: MemoryPlannerRequest[] = [];
  const instructions: string[] = [];
  const actor = requireCompletionCapability(
    createActor({
      id: 'memory-planner',
      ...(options.actorTimeoutMs === undefined
        ? {}
        : { invocationPolicy: { timeoutMilliseconds: options.actorTimeoutMs } }),
      engine: {
        id: 'deterministic-memory',
        capabilities: {
          invocationModes: ['direct'],
          inputMediaTypes: ['text'],
          cancellation: true,
          structuredOutput: false,
          toolCalling: false,
        },
        complete: async (request) => {
          const payload = request.messages[0]?.text;
          if (payload === undefined) throw new Error('Missing planner payload.');
          const parsed = JSON.parse(payload) as MemoryPlannerRequest;
          requests.push(parsed);
          instructions.push(request.instructions);
          const output = await plan(parsed, requests.length, request.signal);
          return {
            message: defineAssistantModelMessage({
              role: 'assistant',
              text: typeof output === 'string' ? output : JSON.stringify(output),
              provenance: defineProviderModelExecutionProvenance({
                provider: 'deterministic',
                model: 'memory',
              }),
              stopReason: options.stopReason ?? 'stop',
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
        },
      },
    })
  );
  const planner = createCompletionMemoryPlanner({
    completion: actor,
    ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    ...(options.maxOutputCharacters === undefined
      ? {}
      : { maxOutputCharacters: options.maxOutputCharacters }),
  });
  let id = 0;
  const resources = createModelMemoryResources({
    store: base.store,
    meter: base.meter,
    planner,
    defaults: { measurementRef: 'chars', ...options.defaults },
    createItemId: () => `item-${++id}`,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
  const bundle = createContextMemoryBundle({
    resources,
    ...(options.workflows === undefined ? {} : { workflows: options.workflows }),
  });
  return { ...base, bundle, resources, requests, instructions, actor, planner };
}
export function firstId(request: MemoryPlannerRequest): string {
  const id = request.items[0]?.id;
  if (id === undefined) throw new Error('Expected a candidate item.');
  return id;
}
