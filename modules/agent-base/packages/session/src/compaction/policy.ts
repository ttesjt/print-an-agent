import { AgentSessionError } from '../errors.js';
import type { SessionCompactionPolicy } from './contracts.js';

const MAX_POLICY_INTEGER = 1_000_000;
export const MAX_SESSION_COMPACTION_CHARACTERS = MAX_POLICY_INTEGER;

export const DEFAULT_SESSION_COMPACTION_POLICY: SessionCompactionPolicy = Object.freeze({
  minimumCompletedTurns: 4,
  retainRecentTurns: 2,
  maxSourceTurns: 32,
  maxSourceCharacters: 32_768,
  maxContextCharacters: 4_096,
  timeoutMilliseconds: 30_000,
});

function requirePositiveInteger(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_POLICY_INTEGER
  ) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      `${name} must be a positive safe integer no greater than ${MAX_POLICY_INTEGER}.`
    );
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_POLICY_INTEGER
  ) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      `${name} must be a non-negative safe integer no greater than ${MAX_POLICY_INTEGER}.`
    );
  }
  return value;
}

export function validateSessionCompactionPolicy(policy: unknown): SessionCompactionPolicy {
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction policy must be an object.'
    );
  }
  const candidate = policy as Partial<Record<keyof SessionCompactionPolicy, unknown>>;
  const minimumCompletedTurns = requirePositiveInteger(
    candidate.minimumCompletedTurns,
    'minimumCompletedTurns'
  );
  const retainRecentTurns = requireNonNegativeInteger(
    candidate.retainRecentTurns,
    'retainRecentTurns'
  );
  if (minimumCompletedTurns <= retainRecentTurns) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'minimumCompletedTurns must be greater than retainRecentTurns.'
    );
  }
  return Object.freeze({
    minimumCompletedTurns,
    retainRecentTurns,
    maxSourceTurns: requirePositiveInteger(candidate.maxSourceTurns, 'maxSourceTurns'),
    maxSourceCharacters: requirePositiveInteger(
      candidate.maxSourceCharacters,
      'maxSourceCharacters'
    ),
    maxContextCharacters: requirePositiveInteger(
      candidate.maxContextCharacters,
      'maxContextCharacters'
    ),
    timeoutMilliseconds: requirePositiveInteger(
      candidate.timeoutMilliseconds,
      'timeoutMilliseconds'
    ),
  });
}
