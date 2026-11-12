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
  parseExportCapabilityResult,
  type ExportCapability,
  type ExportCapabilityRequest,
  type ExportCapabilityResult,
  type ExportCapabilityResultInput,
} from './contracts.js';

export interface ExporterCapabilityContracts {
  readonly input: ExtensionValueContract<JsonValue>;
  readonly resultData?: ExtensionValueContract<JsonValue>;
}

export interface ExporterCapabilityRuntime extends WorkbenchExtensionRuntime<
  typeof WorkbenchExtensionFamily.ModelCapability,
  typeof ModelCapabilityKind.Exporter
> {
  readonly capabilityId: CapabilityId;
  readonly contracts: ExporterCapabilityContracts;
  readonly export: ExportCapability;
  readonly parseResult: (input: unknown, path?: string) => ExportCapabilityResult;
}

export type TypedExporterCapability<TInput, TResultData = JsonValue> = (
  request: ExportCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<CapabilityDispatch<ExportCapabilityResultInput<TResultData>>>;

export interface ExporterCapabilityRuntimeInput<TInput, TResultData = JsonValue> {
  readonly capabilityId: string;
  readonly metadata?: unknown;
  readonly input: ExtensionValueContract<TInput>;
  readonly resultData?: ExtensionValueContract<TResultData>;
  readonly export: TypedExporterCapability<TInput, TResultData>;
}

export function defineExporterCapability<TInput, TResultData = JsonValue>(
  input: ExporterCapabilityRuntimeInput<TInput, TResultData>
): ExporterCapabilityRuntime {
  if (typeof input.export !== 'function') {
    invalidExtension('exporterCapability.export', 'must be a function');
  }
  const capabilityId = parseDomainValue(
    () => parseCapabilityId(input.capabilityId, 'exporterCapability.capabilityId'),
    'exporterCapability.capabilityId'
  );
  const metadata = parseExtensionMetadata(input.metadata, 'exporterCapability.metadata');
  const evidence = parseJsonValue({
    family: WorkbenchExtensionFamily.ModelCapability,
    kind: ModelCapabilityKind.Exporter,
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
    kind: ModelCapabilityKind.Exporter,
    capabilityId,
    ...(metadata === undefined ? {} : { metadata }),
    contracts,
    evidenceDigest: deriveEvidenceDigest(evidence),
    export: createExporterInvoker(input),
    parseResult: createExporterResultParser(input),
  });
}

function createExporterInvoker<TInput, TResultData>(
  input: ExporterCapabilityRuntimeInput<TInput, TResultData>
): ExportCapability {
  return async (request, options) => {
    const typedInput = input.input.parse(request.input, 'exporterCapability.request.input');
    const rawDispatch = await input.export(
      Object.freeze({ ...request, input: typedInput }),
      options
    );
    return parseCapabilityDispatch(
      rawDispatch,
      createExporterResultParser(input),
      'exporterCapability.dispatch'
    );
  };
}

function createExporterResultParser<TInput, TResultData>(
  input: ExporterCapabilityRuntimeInput<TInput, TResultData>
): (value: unknown, path?: string) => ExportCapabilityResult {
  return (value, path = 'exporterCapability.result') => {
    const result = parseExportCapabilityResult(value, path);
    if (result.data === undefined || input.resultData === undefined) return result;
    return Object.freeze({
      ...result,
      data: parseJsonValue(input.resultData.parse(result.data, `${path}.data`), `${path}.data`),
    });
  };
}
