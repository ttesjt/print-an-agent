import {
  deriveEvidenceDigest,
  parseCapabilityId,
  parseJsonValue,
  type CapabilityId,
  type JsonValue,
} from '@ta-agent/workbench-domain';

import type { ExtensionValueContract } from '../../contracts/extension-value-contract.js';
import {
  CapabilityOutcomeStatus,
  ModelCapabilityKind,
  WorkbenchExtensionFamily,
} from '../../foundation/constants.js';
import type {
  ExtensionCallOptions,
  WorkbenchExtensionRuntime,
} from '../../foundation/extension-runtime.js';
import {
  invalidExtension,
  parseDomainValue,
  parseExtensionMetadata,
} from '../../foundation/validation.js';
import {
  parseInitializationCapabilityOutcome,
  type InitializationCapabilityRequest,
  type InitializeCapability,
} from './contracts.js';

export interface InitializerCapabilityContracts {
  readonly input: ExtensionValueContract<JsonValue>;
  readonly resultData?: ExtensionValueContract<JsonValue>;
}

export interface InitializerCapabilityRuntime extends WorkbenchExtensionRuntime<
  typeof WorkbenchExtensionFamily.ModelCapability,
  typeof ModelCapabilityKind.Initializer
> {
  readonly capabilityId: CapabilityId;
  readonly contracts: InitializerCapabilityContracts;
  readonly initialize: InitializeCapability;
}

export type TypedInitializerCapability<TInput> = (
  request: InitializationCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<unknown>;

export interface InitializerCapabilityRuntimeInput<TInput, TResultData = JsonValue> {
  readonly capabilityId: string;
  readonly metadata?: unknown;
  readonly input: ExtensionValueContract<TInput>;
  readonly resultData?: ExtensionValueContract<TResultData>;
  readonly initialize: TypedInitializerCapability<TInput>;
}

export function defineInitializerCapability<TInput, TResultData = JsonValue>(
  input: InitializerCapabilityRuntimeInput<TInput, TResultData>
): InitializerCapabilityRuntime {
  if (typeof input.initialize !== 'function') {
    invalidExtension('initializerCapability.initialize', 'must be a function');
  }
  const capabilityId = parseDomainValue(
    () => parseCapabilityId(input.capabilityId, 'initializerCapability.capabilityId'),
    'initializerCapability.capabilityId'
  );
  const metadata = parseExtensionMetadata(input.metadata, 'initializerCapability.metadata');
  const evidence = parseJsonValue({
    family: WorkbenchExtensionFamily.ModelCapability,
    kind: ModelCapabilityKind.Initializer,
    capabilityId,
    contracts: {
      input: input.input.evidence,
      ...(input.resultData === undefined ? {} : { resultData: input.resultData.evidence }),
    },
    ...(metadata === undefined ? {} : { metadata }),
  });
  const contracts = Object.freeze({
    input: eraseValueContract(input.input),
    ...(input.resultData === undefined ? {} : { resultData: eraseValueContract(input.resultData) }),
  });

  return Object.freeze({
    family: WorkbenchExtensionFamily.ModelCapability,
    kind: ModelCapabilityKind.Initializer,
    capabilityId,
    ...(metadata === undefined ? {} : { metadata }),
    contracts,
    evidenceDigest: deriveEvidenceDigest(evidence),
    initialize: createInitializerInvoker(input),
  });
}

function createInitializerInvoker<TInput, TResultData>(
  input: InitializerCapabilityRuntimeInput<TInput, TResultData>
): InitializeCapability {
  return async (request, options) => {
    const typedInput = input.input.parse(request.input, 'initializerCapability.request.input');
    const rawOutcome = await input.initialize(
      Object.freeze({ ...request, input: typedInput }),
      options
    );
    const outcome = parseInitializationCapabilityOutcome(
      rawOutcome,
      'initializerCapability.outcome'
    );
    if (
      outcome.status !== CapabilityOutcomeStatus.Succeeded ||
      outcome.data === undefined ||
      input.resultData === undefined
    ) {
      return outcome;
    }
    return Object.freeze({
      ...outcome,
      data: parseJsonValue(
        input.resultData.parse(outcome.data, 'initializerCapability.outcome.data'),
        'initializerCapability.outcome.data'
      ),
    });
  };
}

function eraseValueContract<TValue>(
  contract: ExtensionValueContract<TValue>
): ExtensionValueContract<JsonValue> {
  return Object.freeze({
    evidence: contract.evidence,
    parse: (input: unknown, path: string) => parseJsonValue(contract.parse(input, path), path),
  });
}
