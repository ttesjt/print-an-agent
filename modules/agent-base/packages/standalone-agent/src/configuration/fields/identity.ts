import {
  defineAgentIdentity,
  type AgentIdentity,
} from '@print-an-agent/base-identity-config/identity';
import { AgentBaseStandaloneError } from '../../errors.js';
import { assertExactKeys, requireRecord } from '../validation.js';

const IDENTITY_KEYS = Object.freeze(['id', 'displayName']);

export function parseIdentity(value: unknown): AgentIdentity {
  const record = requireRecord(value, 'Standalone identity');
  assertExactKeys(record, IDENTITY_KEYS, 'Standalone identity');
  if (typeof record.id !== 'string') {
    throw new AgentBaseStandaloneError('Standalone identity ID must be a string.');
  }
  if (record.displayName !== undefined && typeof record.displayName !== 'string') {
    throw new AgentBaseStandaloneError('Standalone identity display name must be a string.');
  }
  return defineAgentIdentity({
    id: record.id,
    ...(record.displayName === undefined ? {} : { displayName: record.displayName }),
  });
}
