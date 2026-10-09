import {
  deriveEvidenceDigest,
  parseCapabilityId,
  parseJsonValue,
  type CapabilityId,
  type JsonValue,
} from '@ta-agent/workbench-domain';

import type { ExtensionValueContract } from '../../contracts/extension-value-contract.js';
import { ModelCapabilityKind, WorkbenchExtensionFamily } from '../../foundation/constants.js';
import type {
  ExtensionCallOptions,
  WorkbenchExtensionRuntime,
} from '../../foundation/extension-runtime.js';
import {
  invalidExtension,
  parseDomainValue,
  parseExtensionMetadata,
} from '../../foundation/validation.js';
import { eraseValueContract } from '../shared/value-contract.js';
import { OutputInvocationKind } from './constants.js';
import { parseOutputStream } from './parse-output-stream.js';
import type {
  InvokeOutputCapability,
  OutputInvocation,
  OutputInvocationCapabilityRequest,
} from './contracts.js';

export interface OutputInvokerCapabilityContracts {
  readonly input: ExtensionValueContract<JsonValue>;
  readonly output: ExtensionValueContract<JsonValue>;
}

export interface OutputInvokerCapabilityRuntime extends WorkbenchExtensionRuntime<
  typeof WorkbenchExtensionFamily.ModelCapability,
  typeof ModelCapabilityKind.OutputInvoker
> {
  readonly capabilityId: CapabilityId;
  readonly contracts: OutputInvokerCapabilityContracts;
  readonly invoke: InvokeOutputCapability;
}

export type TypedOutputInvokerCapability<TInput, TOutput> = (
  request: OutputInvocationCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<OutputInvocation<TOutput>>;

export interface OutputInvokerCapabilityRuntimeInput<TInput, TOutput> {
  readonly capabilityId: string;
  readonly metadata?: unknown;
  readonly input: ExtensionValueContract<TInput>;
  readonly output: ExtensionValueContract<TOutput>;
  readonly invoke: TypedOutputInvokerCapability<TInput, TOutput>;
}

export function defineOutputInvokerCapability<TInput, TOutput>(
  input: OutputInvokerCapabilityRuntimeInput<TInput, TOutput>
): OutputInvokerCapabilityRuntime {
  if (typeof input.invoke !== 'function') {
    invalidExtension('outputInvokerCapability.invoke', 'must be a function');
  }
  const capabilityId = parseDomainValue(
    () => parseCapabilityId(input.capabilityId, 'outputInvokerCapability.capabilityId'),
    'outputInvokerCapability.capabilityId'
  );
  const metadata = parseExtensionMetadata(input.metadata, 'outputInvokerCapability.metadata');
  const evidence = parseJsonValue({
    family: WorkbenchExtensionFamily.ModelCapability,
    kind: ModelCapabilityKind.OutputInvoker,
    capabilityId,
    contracts: {
      input: input.input.evidence,
      output: input.output.evidence,
    },
    ...(metadata === undefined ? {} : { metadata }),
  });

  return Object.freeze({
    family: WorkbenchExtensionFamily.ModelCapability,
    kind: ModelCapabilityKind.OutputInvoker,
    capabilityId,
    ...(metadata === undefined ? {} : { metadata }),
    contracts: Object.freeze({
      input: eraseValueContract(input.input),
      output: eraseValueContract(input.output),
    }),
    evidenceDigest: deriveEvidenceDigest(evidence),
    invoke: createOutputInvoker(input),
  });
}

function createOutputInvoker<TInput, TOutput>(
  input: OutputInvokerCapabilityRuntimeInput<TInput, TOutput>
): InvokeOutputCapability {
  return async (request, options) => {
    const typedInput = input.input.parse(request.input, 'outputInvokerCapability.request.input');
    const rawDispatch = await input.invoke(
      Object.freeze({ ...request, input: typedInput }),
      options
    );
    return parseOutputInvocation(
      rawDispatch,
      createOutputResultParser(input),
      'outputInvokerCapability.invocation'
    );
  };
}

function parseOutputInvocation(
  input: unknown,
  parseResult: (value: unknown, path?: string) => JsonValue,
  path: string
): OutputInvocation<JsonValue> {
  if (!isRecord(input)) invalidExtension(path, 'must be an object');
  if (input.kind === OutputInvocationKind.Completed) {
    assertKeys(input, path, ['kind', 'result']);
    return Object.freeze({
      kind: OutputInvocationKind.Completed,
      result: parseResult(input.result, `${path}.result`),
    });
  }
  if (input.kind === OutputInvocationKind.Streaming) {
    assertKeys(input, path, ['kind', 'stream']);
    if (!isAsyncIterable(input.stream)) {
      invalidExtension(`${path}.stream`, 'must be an AsyncIterable');
    }
    return Object.freeze({
      kind: OutputInvocationKind.Streaming,
      stream: parseOutputStream(input.stream, parseResult, `${path}.stream`),
    });
  }
  return invalidExtension(
    `${path}.kind`,
    `must equal ${OutputInvocationKind.Completed} or ${OutputInvocationKind.Streaming}`
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isAsyncIterable(input: unknown): input is AsyncIterable<unknown> {
  if ((typeof input !== 'object' || input === null) && typeof input !== 'function') return false;
  return (
    typeof (input as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
    'function'
  );
}

function assertKeys(
  input: Record<string, unknown>,
  path: string,
  expected: readonly string[]
): void {
  const unexpected = Object.keys(input).filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !Object.hasOwn(input, key));
  if (missing.length > 0) invalidExtension(path, `must include ${missing.join(', ')}`);
  if (unexpected.length > 0) invalidExtension(path, `must not include ${unexpected.join(', ')}`);
}

function createOutputResultParser<TInput, TOutput>(
  input: OutputInvokerCapabilityRuntimeInput<TInput, TOutput>
): (value: unknown, path?: string) => JsonValue {
  return (value, path = 'outputInvokerCapability.result') =>
    parseJsonValue(input.output.parse(value, path), path);
}
