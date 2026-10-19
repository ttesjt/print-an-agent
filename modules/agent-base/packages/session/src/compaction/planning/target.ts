import { AgentSessionError } from '../../errors.js';
import type { SessionCompactionTarget } from './contracts.js';
import { compactionInteger, compactionRatio, compactionRecord } from './validation.js';

export const DEFAULT_SESSION_COMPACTION_TARGET_RATIO = 0.8;
export const DEFAULT_SESSION_COMPACTION_RESERVE_TOKENS = 0;

export function defineSessionCompactionTarget(input: unknown): SessionCompactionTarget {
  const record = compactionRecord(
    input,
    ['maxTokens', 'limitTokens', 'ratio', 'reserveTokens'],
    'Compaction target'
  );
  if (Object.hasOwn(record, 'maxTokens')) {
    if (Object.keys(record).length !== 1) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_INVALID',
        'Direct and calculated compaction targets cannot be mixed.'
      );
    }
    return Object.freeze({ maxTokens: compactionInteger(record.maxTokens, 'maxTokens') });
  }
  return Object.freeze({
    ...(Object.hasOwn(record, 'limitTokens')
      ? { limitTokens: compactionInteger(record.limitTokens, 'limitTokens') }
      : {}),
    ...(Object.hasOwn(record, 'ratio') ? { ratio: compactionRatio(record.ratio, 'ratio') } : {}),
    ...(Object.hasOwn(record, 'reserveTokens')
      ? { reserveTokens: compactionInteger(record.reserveTokens, 'reserveTokens', 0) }
      : {}),
  });
}

export function resolveSessionCompactionTarget(
  maxContextTokens: number,
  configured: SessionCompactionTarget,
  override?: SessionCompactionTarget
): number {
  compactionInteger(maxContextTokens, 'maxContextTokens');
  const inherited = defineSessionCompactionTarget(configured);
  const target = override === undefined ? inherited : defineSessionCompactionTarget(override);
  const tokens =
    target.maxTokens ??
    Math.floor(
      (target.limitTokens ?? maxContextTokens) *
        (target.ratio ?? inherited.ratio ?? DEFAULT_SESSION_COMPACTION_TARGET_RATIO)
    ) - (target.reserveTokens ?? DEFAULT_SESSION_COMPACTION_RESERVE_TOKENS);
  compactionInteger(tokens, 'Resolved compaction target');
  if (tokens > maxContextTokens) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Compaction target cannot exceed the configured context token limit.'
    );
  }
  return tokens;
}
