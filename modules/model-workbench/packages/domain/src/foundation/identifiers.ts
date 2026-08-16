import { InvalidWorkbenchValueError } from './errors.js';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

declare const profileIdBrand: unique symbol;
declare const initializerIdBrand: unique symbol;
declare const capabilityIdBrand: unique symbol;
declare const runtimeSupportIdBrand: unique symbol;
declare const runtimeBindingIdBrand: unique symbol;
declare const runIdBrand: unique symbol;
declare const baseIdBrand: unique symbol;
declare const artifactIdBrand: unique symbol;
declare const sha256DigestBrand: unique symbol;

export type ProfileId = string & { readonly [profileIdBrand]: 'ProfileId' };
export type InitializerId = string & { readonly [initializerIdBrand]: 'InitializerId' };
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
export type ArtifactId = string & { readonly [artifactIdBrand]: 'ArtifactId' };
export type Sha256Digest = string & { readonly [sha256DigestBrand]: 'Sha256Digest' };

export function parseProfileId(input: unknown, path = 'profileId'): ProfileId {
  return parseIdentifier(input, path) as ProfileId;
}

export function parseInitializerId(input: unknown, path = 'initializerId'): InitializerId {
  return parseIdentifier(input, path) as InitializerId;
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
