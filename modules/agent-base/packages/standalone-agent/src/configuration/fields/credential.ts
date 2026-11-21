import { AgentBaseStandaloneError } from '../../errors.js';
import type { StandaloneCredentialBindingInput } from '../types/credential.js';
import { assertExactKeys, requireRecord } from '../validation.js';

const CREDENTIAL_KEYS = Object.freeze(['reference', 'environmentVariable']);

const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

const MAX_ENVIRONMENT_VARIABLE_LENGTH = 128;

export function parseCredential(
  value: unknown,
  expectedReference: string | undefined
): Readonly<StandaloneCredentialBindingInput> | undefined {
  if (expectedReference === undefined) {
    if (value !== undefined) {
      throw new AgentBaseStandaloneError(
        'Keyless provider configuration cannot include a credential binding.'
      );
    }
    return undefined;
  }
  const record = requireRecord(value, 'Standalone credential binding');
  assertExactKeys(record, CREDENTIAL_KEYS, 'Standalone credential binding');
  if (record.reference !== expectedReference) {
    throw new AgentBaseStandaloneError(
      'Standalone credential binding must match the provider credential reference.'
    );
  }
  if (
    typeof record.environmentVariable !== 'string' ||
    record.environmentVariable.length > MAX_ENVIRONMENT_VARIABLE_LENGTH ||
    !ENVIRONMENT_VARIABLE_PATTERN.test(record.environmentVariable)
  ) {
    throw new AgentBaseStandaloneError(
      'Credential environmentVariable must be a bounded portable environment name.'
    );
  }
  return Object.freeze({
    reference: expectedReference,
    environmentVariable: record.environmentVariable,
  });
}
