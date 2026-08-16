import {
  defineModelProfile,
  parseCapabilityId,
  parseInitializerId,
  parseProfileId,
  parseRuntimeBindingId,
  type ModelProfile,
} from '@ta-agent/workbench-domain';

import {
  assertUnique,
  invalidSetup,
  parseArray,
  parseClosedRecord,
  parseDomainValue,
} from '../foundation/parsing.js';

export function parseModelProfile(input: unknown, index: number): ModelProfile {
  const path = `setup.profiles[${String(index)}]`;
  const record = parseClosedRecord(input, path, ['profileId', 'initializers']);
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
  return defineModelProfile({ profileId, initializers });
}
