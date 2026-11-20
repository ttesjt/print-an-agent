import { AgentRequestError } from '@print-an-agent/base-request';
import { AgentSessionError } from '@print-an-agent/base-session';
import { parseToolName, type ToolName } from '@print-an-agent/base-tool';
import { MAX_COMPACTION_INSTRUCTIONS_CHARACTERS } from './defaults.js';

export function validateCompactionInstructions(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_COMPACTION_INSTRUCTIONS_CHARACTERS
  ) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      `Session compaction instructions must contain 1-${MAX_COMPACTION_INSTRUCTIONS_CHARACTERS} characters.`
    );
  }
  return value;
}

export function parseToolAllowList(values: readonly string[] | undefined): readonly ToolName[] {
  const parsed = (values ?? []).map(parseToolName);
  if (new Set(parsed).size !== parsed.length) {
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Agent Base Tool allow-lists cannot contain duplicate names.'
    );
  }
  return Object.freeze(parsed);
}
