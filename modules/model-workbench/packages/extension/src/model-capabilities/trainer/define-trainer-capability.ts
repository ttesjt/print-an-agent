import {
  deriveEvidenceDigest,
  parseCapabilityId,
  parseJsonValue,
  type CapabilityId,
  type JsonValue,
} from '@print-an-agent/workbench-domain';

import type { ExtensionValueContract } from '../../contracts/extension-value-contract.js';
import type { CapabilityDispatch } from '../../execution-protocol/contracts.js';
import { parseCapabilityDispatch } from '../../execution-protocol/parsing.js';
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
import {
  parseTrainingCapabilityResult,
  type TrainCapability,
  type TrainingCapabilityRequest,
  type TrainingCapabilityResult,
  type TrainingCapabilityResultInput,
} from './contracts.js';

export interface TrainerCapabilityContracts {
  readonly input: ExtensionValueContract<JsonValue>;
  readonly resultData?: ExtensionValueContract<JsonValue>;
}

export interface TrainerCapabilityRuntime extends WorkbenchExtensionRuntime<
  typeof WorkbenchExtensionFamily.ModelCapability,
  typeof ModelCapabilityKind.Trainer
> {
  readonly capabilityId: CapabilityId;
  readonly contracts: TrainerCapabilityContracts;
  readonly train: TrainCapability;
  readonly parseResult: (input: unknown, path?: string) => TrainingCapabilityResult;
}

export type TypedTrainerCapability<TInput, TResultData = JsonValue> = (
  request: TrainingCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<CapabilityDispatch<TrainingCapabilityResultInput<TResultData>>>;

export interface TrainerCapabilityRuntimeInput<TInput, TResultData = JsonValue> {
  readonly capabilityId: string;
  readonly metadata?: unknown;
  readonly input: ExtensionValueContract<TInput>;
  readonly resultData?: ExtensionValueContract<TResultData>;
  readonly train: TypedTrainerCapability<TInput, TResultData>;
}

export function defineTrainerCapability<TInput, TResultData = JsonValue>(
  input: TrainerCapabilityRuntimeInput<TInput, TResultData>
): TrainerCapabilityRuntime {
  if (typeof input.train !== 'function') {
    invalidExtension('trainerCapability.train', 'must be a function');
  }
  const capabilityId = parseDomainValue(
    () => parseCapabilityId(input.capabilityId, 'trainerCapability.capabilityId'),
    'trainerCapability.capabilityId'
  );
  const metadata = parseExtensionMetadata(input.metadata, 'trainerCapability.metadata');
  const evidence = parseJsonValue({
    family: WorkbenchExtensionFamily.ModelCapability,
    kind: ModelCapabilityKind.Trainer,
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
    kind: ModelCapabilityKind.Trainer,
    capabilityId,
    ...(metadata === undefined ? {} : { metadata }),
    contracts,
    evidenceDigest: deriveEvidenceDigest(evidence),
    train: createTrainerInvoker(input),
    parseResult: createTrainerResultParser(input),
  });
}

function createTrainerInvoker<TInput, TResultData>(
  input: TrainerCapabilityRuntimeInput<TInput, TResultData>
): TrainCapability {
  return async (request, options) => {
    const typedInput = input.input.parse(request.input, 'trainerCapability.request.input');
    const rawDispatch = await input.train(
      Object.freeze({ ...request, input: typedInput }),
      options
    );
    return parseCapabilityDispatch(
      rawDispatch,
      createTrainerResultParser(input),
      'trainerCapability.dispatch'
    );
  };
}

function createTrainerResultParser<TInput, TResultData>(
  input: TrainerCapabilityRuntimeInput<TInput, TResultData>
): (value: unknown, path?: string) => TrainingCapabilityResult {
  return (value, path = 'trainerCapability.result') => {
    const result = parseTrainingCapabilityResult(value, path);
    if (result.data === undefined || input.resultData === undefined) return result;
    return Object.freeze({
      ...result,
      data: parseJsonValue(input.resultData.parse(result.data, `${path}.data`), `${path}.data`),
    });
  };
}
