import { AgentRequestError, createSessionlessRequestWorkflow } from '@ta-agent/base-request';
import type {
  SessionlessGenerationServiceDefinition,
  SessionlessGenerationWorkflow,
  SessionlessInteractionServiceDefinition,
  SessionlessInteractionWorkflow,
  SessionlessRequestService,
} from './contracts.js';

function assertFields(value: unknown, keys: readonly string[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Invalid Sessionless Service definition.'
    );
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(value).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== 'string' ||
        !keys.includes(key) ||
        !descriptor?.enumerable ||
        !('value' in descriptor)
      );
    })
  )
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Invalid Sessionless Service definition.'
    );
}

export function createSessionlessRequestService<TTarget>(
  definition: SessionlessGenerationServiceDefinition<TTarget>
): SessionlessRequestService<TTarget, SessionlessGenerationWorkflow>;
export function createSessionlessRequestService<TTarget>(
  definition: SessionlessInteractionServiceDefinition<TTarget>
): SessionlessRequestService<TTarget, SessionlessInteractionWorkflow>;
export function createSessionlessRequestService<TTarget>(
  definition:
    | SessionlessGenerationServiceDefinition<TTarget>
    | SessionlessInteractionServiceDefinition<TTarget>
): SessionlessRequestService<
  TTarget,
  SessionlessGenerationWorkflow | SessionlessInteractionWorkflow
> {
  assertFields(definition, ['workflow', 'resolveResources']);
  assertFields(definition.workflow, [
    'mode',
    'name',
    'stepOverrides',
    'lifecycle',
    'condition',
    'createRunId',
    'executeStep',
  ]);
  const workflow = Object.freeze({ ...definition.workflow });
  const resolve = definition.resolveResources;
  if (
    !['direct', 'stream', 'interaction'].includes(workflow.mode) ||
    typeof resolve !== 'function'
  ) {
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Invalid Sessionless Service profile or resolver.'
    );
  }
  return Object.freeze({
    async open(target: TTarget, options: Readonly<{ signal?: AbortSignal }> = {}) {
      const signal = options.signal ?? new AbortController().signal;
      signal.throwIfAborted();
      const resources = await resolve({ target, signal });
      signal.throwIfAborted();
      return workflow.mode === 'interaction'
        ? createSessionlessRequestWorkflow({ ...workflow, resources })
        : createSessionlessRequestWorkflow({ ...workflow, resources });
    },
  });
}
