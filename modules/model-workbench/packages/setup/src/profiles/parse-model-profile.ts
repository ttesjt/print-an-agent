import {
  defineModelProfile,
  parseCapabilityId,
  parseExporterId,
  parseInitializerId,
  parseProfileId,
  parseOutputInvokerId,
  parseRuntimeBindingId,
  parseTrainerId,
  type ModelProfile,
  type JsonObject,
  parseJsonValue,
} from '@ta-agent/workbench-domain';

import {
  assertUnique,
  invalidSetup,
  parseArray,
  parseClosedRecord,
  parseDomainValue,
} from '../foundation/parsing.js';

import type { ResolvedProfileInfrastructure } from './contracts.js';

export interface ParsedModelProfile {
  readonly source: ModelProfile;
  readonly infrastructure: ResolvedProfileInfrastructure;
}

export function parseModelProfile(input: unknown, index: number): ParsedModelProfile {
  const path = `setup.profiles[${String(index)}]`;
  const record = parseClosedRecord(
    input,
    path,
    ['profileId', 'initializers'],
    ['trainers', 'exporters', 'outputInvokers', 'infrastructure']
  );
  const profileId = parseDomainValue(
    () => parseProfileId(record.profileId, `${path}.profileId`),
    `${path}.profileId`
  );
  const initializers = parseArray(record.initializers, `${path}.initializers`).map(
    (initializer, initializerIndex) => {
      const initializerPath = `${path}.initializers[${String(initializerIndex)}]`;
      const initializerRecord = parseClosedRecord(initializer, initializerPath, [
        'initializerId',
        'capabilityId',
        'runtimeBindingId',
      ]);
      return Object.freeze({
        initializerId: parseDomainValue(
          () =>
            parseInitializerId(initializerRecord.initializerId, `${initializerPath}.initializerId`),
          `${initializerPath}.initializerId`
        ),
        capabilityId: parseDomainValue(
          () =>
            parseCapabilityId(initializerRecord.capabilityId, `${initializerPath}.capabilityId`),
          `${initializerPath}.capabilityId`
        ),
        runtimeBindingId: parseDomainValue(
          () =>
            parseRuntimeBindingId(
              initializerRecord.runtimeBindingId,
              `${initializerPath}.runtimeBindingId`
            ),
          `${initializerPath}.runtimeBindingId`
        ),
      });
    }
  );
  if (initializers.length === 0) invalidSetup(`${path}.initializers`, 'must not be empty');
  assertUnique(initializers, ({ initializerId }) => initializerId, `${path}.initializers`);
  const trainerInputs = Object.hasOwn(record, 'trainers')
    ? parseArray(record.trainers, `${path}.trainers`)
    : [];
  const trainers = trainerInputs.map((trainer, trainerIndex) => {
    const trainerPath = `${path}.trainers[${String(trainerIndex)}]`;
    const trainerRecord = parseClosedRecord(trainer, trainerPath, [
      'trainerId',
      'capabilityId',
      'runtimeBindingId',
    ]);
    return Object.freeze({
      trainerId: parseDomainValue(
        () => parseTrainerId(trainerRecord.trainerId, `${trainerPath}.trainerId`),
        `${trainerPath}.trainerId`
      ),
      capabilityId: parseDomainValue(
        () => parseCapabilityId(trainerRecord.capabilityId, `${trainerPath}.capabilityId`),
        `${trainerPath}.capabilityId`
      ),
      runtimeBindingId: parseDomainValue(
        () =>
          parseRuntimeBindingId(trainerRecord.runtimeBindingId, `${trainerPath}.runtimeBindingId`),
        `${trainerPath}.runtimeBindingId`
      ),
    });
  });
  assertUnique(trainers, ({ trainerId }) => trainerId, `${path}.trainers`);
  const exporterInputs = Object.hasOwn(record, 'exporters')
    ? parseArray(record.exporters, `${path}.exporters`)
    : [];
  const exporters = exporterInputs.map((exporter, exporterIndex) => {
    const exporterPath = `${path}.exporters[${String(exporterIndex)}]`;
    const exporterRecord = parseClosedRecord(exporter, exporterPath, [
      'exporterId',
      'capabilityId',
      'runtimeBindingId',
    ]);
    return Object.freeze({
      exporterId: parseDomainValue(
        () => parseExporterId(exporterRecord.exporterId, `${exporterPath}.exporterId`),
        `${exporterPath}.exporterId`
      ),
      capabilityId: parseDomainValue(
        () => parseCapabilityId(exporterRecord.capabilityId, `${exporterPath}.capabilityId`),
        `${exporterPath}.capabilityId`
      ),
      runtimeBindingId: parseDomainValue(
        () =>
          parseRuntimeBindingId(
            exporterRecord.runtimeBindingId,
            `${exporterPath}.runtimeBindingId`
          ),
        `${exporterPath}.runtimeBindingId`
      ),
    });
  });
  assertUnique(exporters, ({ exporterId }) => exporterId, `${path}.exporters`);
  const outputInvokerInputs = Object.hasOwn(record, 'outputInvokers')
    ? parseArray(record.outputInvokers, `${path}.outputInvokers`)
    : [];
  const outputInvokers = outputInvokerInputs.map((outputInvoker, outputInvokerIndex) => {
    const outputInvokerPath = `${path}.outputInvokers[${String(outputInvokerIndex)}]`;
    const outputInvokerRecord = parseClosedRecord(outputInvoker, outputInvokerPath, [
      'outputInvokerId',
      'capabilityId',
      'runtimeBindingId',
    ]);
    return Object.freeze({
      outputInvokerId: parseDomainValue(
        () =>
          parseOutputInvokerId(
            outputInvokerRecord.outputInvokerId,
            `${outputInvokerPath}.outputInvokerId`
          ),
        `${outputInvokerPath}.outputInvokerId`
      ),
      capabilityId: parseDomainValue(
        () =>
          parseCapabilityId(outputInvokerRecord.capabilityId, `${outputInvokerPath}.capabilityId`),
        `${outputInvokerPath}.capabilityId`
      ),
      runtimeBindingId: parseDomainValue(
        () =>
          parseRuntimeBindingId(
            outputInvokerRecord.runtimeBindingId,
            `${outputInvokerPath}.runtimeBindingId`
          ),
        `${outputInvokerPath}.runtimeBindingId`
      ),
    });
  });
  assertUnique(outputInvokers, ({ outputInvokerId }) => outputInvokerId, `${path}.outputInvokers`);
  return Object.freeze({
    source: defineModelProfile({
      profileId,
      initializers,
      trainers,
      exporters,
      outputInvokers,
    }),
    infrastructure: parseProfileInfrastructure(record.infrastructure, path),
  });
}

function parseProfileInfrastructure(
  input: unknown,
  profilePath: string
): ResolvedProfileInfrastructure {
  if (input === undefined) return Object.freeze({ persistence: Object.freeze({}) });
  const path = `${profilePath}.infrastructure`;
  const record = parseClosedRecord(input, path, [], ['persistence']);
  if (!Object.hasOwn(record, 'persistence')) {
    return Object.freeze({ persistence: Object.freeze({}) });
  }
  const persistencePath = `${path}.persistence`;
  const persistence = parseClosedRecord(record.persistence, persistencePath, [], ['configuration']);
  if (!Object.hasOwn(persistence, 'configuration')) {
    return Object.freeze({ persistence: Object.freeze({}) });
  }
  const configuration = parseDomainValue(
    () => parseJsonValue(persistence.configuration, `${persistencePath}.configuration`),
    `${persistencePath}.configuration`
  );
  if (configuration === null || Array.isArray(configuration) || typeof configuration !== 'object') {
    invalidSetup(`${persistencePath}.configuration`, 'must be a JSON object');
  }
  return Object.freeze({
    persistence: Object.freeze({ configuration: configuration as JsonObject }),
  });
}
