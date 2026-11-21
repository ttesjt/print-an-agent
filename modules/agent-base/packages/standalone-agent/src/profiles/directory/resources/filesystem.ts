import { AgentBaseStandaloneError } from '../../../errors.js';

export const DATABASE_FILE_NAME = 'agent.sqlite';

export const MANIFEST_FILE_NAME = 'agent.json';

export const TEMPORARY_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;

export function storageError(message: string, cause?: unknown): AgentBaseStandaloneError {
  return new AgentBaseStandaloneError(message, {
    code: 'STANDALONE_AGENT_STORAGE_INVALID',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function isMissingPathError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'code' in value && value.code === 'ENOENT';
}
