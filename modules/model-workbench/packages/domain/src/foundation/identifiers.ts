import { InvalidWorkbenchValueError } from './errors.js';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

declare const profileIdBrand: unique symbol;
declare const initializerIdBrand: unique symbol;
declare const trainerIdBrand: unique symbol;
declare const exporterIdBrand: unique symbol;
declare const outputInvokerIdBrand: unique symbol;
declare const capabilityIdBrand: unique symbol;
declare const runtimeSupportIdBrand: unique symbol;
declare const runtimeBindingIdBrand: unique symbol;
declare const runIdBrand: unique symbol;
declare const baseIdBrand: unique symbol;
declare const modificationIdBrand: unique symbol;
declare const outputIdBrand: unique symbol;
declare const outputArtifactNameBrand: unique symbol;
declare const artifactIdBrand: unique symbol;
declare const sha256DigestBrand: unique symbol;

export type ProfileId = string & { readonly [profileIdBrand]: 'ProfileId' };
export type InitializerId = string & { readonly [initializerIdBrand]: 'InitializerId' };
export type TrainerId = string & { readonly [trainerIdBrand]: 'TrainerId' };
export type ExporterId = string & { readonly [exporterIdBrand]: 'ExporterId' };
export type OutputInvokerId = string & {
  readonly [outputInvokerIdBrand]: 'OutputInvokerId';
};
export type CapabilityId = string & {
  readonly [capabilityIdBrand]: 'CapabilityId';
};
export type RuntimeSupportId = string & {
  readonly [runtimeSupportIdBrand]: 'RuntimeSupportId';
};
export type RuntimeBindingId = string & {
  readonly [runtimeBindingIdBrand]: 'RuntimeBindingId';
};
export type RunId = string & { readonly [runIdBrand]: 'RunId' };
export type BaseId = string & { readonly [baseIdBrand]: 'BaseId' };
export type ModificationId = string & { readonly [modificationIdBrand]: 'ModificationId' };
export type OutputId = string & { readonly [outputIdBrand]: 'OutputId' };
export type OutputArtifactName = string & {
  readonly [outputArtifactNameBrand]: 'OutputArtifactName';
};
export type ArtifactId = string & { readonly [artifactIdBrand]: 'ArtifactId' };
export type Sha256Digest = string & { readonly [sha256DigestBrand]: 'Sha256Digest' };

export function parseProfileId(input: unknown, path = 'profileId'): ProfileId {
  return parseIdentifier(input, path) as ProfileId;
}

export function parseInitializerId(input: unknown, path = 'initializerId'): InitializerId {
  return parseIdentifier(input, path) as InitializerId;
}

export function parseTrainerId(input: unknown, path = 'trainerId'): TrainerId {
  return parseIdentifier(input, path) as TrainerId;
}

export function parseExporterId(input: unknown, path = 'exporterId'): ExporterId {
  return parseIdentifier(input, path) as ExporterId;
}

export function parseOutputInvokerId(input: unknown, path = 'outputInvokerId'): OutputInvokerId {
  return parseIdentifier(input, path) as OutputInvokerId;
}

export function parseCapabilityId(input: unknown, path = 'capabilityId'): CapabilityId {
  return parseIdentifier(input, path) as CapabilityId;
}

export function parseRuntimeSupportId(input: unknown, path = 'runtimeSupportId'): RuntimeSupportId {
  return parseIdentifier(input, path) as RuntimeSupportId;
}

export function parseRuntimeBindingId(input: unknown, path = 'runtimeBindingId'): RuntimeBindingId {
  return parseIdentifier(input, path) as RuntimeBindingId;
}

export function parseRunId(input: unknown, path = 'runId'): RunId {
  return parseIdentifier(input, path) as RunId;
}

export function parseBaseId(input: unknown, path = 'baseId'): BaseId {
  return parseIdentifier(input, path) as BaseId;
}

export function parseModificationId(input: unknown, path = 'modificationId'): ModificationId {
  return parseIdentifier(input, path) as ModificationId;
}

export function parseOutputId(input: unknown, path = 'outputId'): OutputId {
  return parseIdentifier(input, path) as OutputId;
}

export function parseOutputArtifactName(
  input: unknown,
  path = 'outputArtifactName'
): OutputArtifactName {
  return parseIdentifier(input, path) as OutputArtifactName;
}

export function parseArtifactId(input: unknown, path = 'artifactId'): ArtifactId {
  return parseIdentifier(input, path) as ArtifactId;
}

export function parseSha256Digest(input: unknown, path = 'digest'): Sha256Digest {
  if (typeof input !== 'string' || !SHA256_PATTERN.test(input)) {
    throw new InvalidWorkbenchValueError(path, 'must be a lowercase sha256 digest');
  }
  return input as Sha256Digest;
}

function parseIdentifier(input: unknown, path: string): string {
  if (typeof input !== 'string' || !IDENTIFIER_PATTERN.test(input)) {
    throw new InvalidWorkbenchValueError(
      path,
      'must be 1-128 characters using letters, numbers, dot, underscore, colon, or hyphen'
    );
  }
  return input;
}
