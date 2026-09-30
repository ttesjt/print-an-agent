import { AgentBaseCliError } from './errors.js';
import {
  assertAllowedCliOptions,
  optionalCliOption,
  optionalSafeIntegerCliOption,
  parseCliOptions,
  requireBooleanCliOption,
  requireCliOption,
  requireSafeIntegerCliOption,
  type CliOptionValues,
} from './option-parser.js';

interface SessionLifecycleCommandScope {
  readonly rootDirectory: string;
  readonly agentId: string;
}

export type AgentBaseCliSessionLifecycleCommand =
  | (SessionLifecycleCommandScope &
      Readonly<{
        kind: 'session-lifecycle-list';
        cursor?: Readonly<{ updatedAt: number; sessionId: string }>;
        limit?: number;
      }>)
  | (SessionLifecycleCommandScope &
      Readonly<{
        kind: 'session-lifecycle-list-retired';
        cursor?: Readonly<{ retiredAt: number; sessionId: string }>;
        limit?: number;
      }>)
  | (SessionLifecycleCommandScope &
      Readonly<{ kind: 'session-lifecycle-inspect'; sessionId: string }>)
  | (SessionLifecycleCommandScope &
      Readonly<{
        kind: 'session-lifecycle-turns';
        sessionId: string;
        beforeTurnId?: string;
        limit?: number;
      }>)
  | (SessionLifecycleCommandScope &
      Readonly<{
        kind: 'session-lifecycle-retire';
        sessionId: string;
        expectedRevision: number;
      }>)
  | (SessionLifecycleCommandScope &
      Readonly<{
        kind: 'session-lifecycle-restore';
        sessionId: string;
        expectedRevision: number;
      }>)
  | (SessionLifecycleCommandScope &
      Readonly<{
        kind: 'session-lifecycle-purge';
        sessionId: string;
        expectedRevision: number;
      }>)
  | (SessionLifecycleCommandScope &
      Readonly<{
        kind: 'session-lifecycle-recover';
        sessionId: string;
        expectedExecutionRevision: number;
      }>);

const BOOLEAN_OPTIONS = new Set(['confirm-permanent-delete']);
const QUERY_LIMIT_MAXIMUM = 200;

function scope(options: CliOptionValues): SessionLifecycleCommandScope {
  return Object.freeze({
    rootDirectory: requireCliOption(options, 'root'),
    agentId: requireCliOption(options, 'agent-id'),
  });
}

function optionalLimit(options: CliOptionValues): number | undefined {
  return optionalSafeIntegerCliOption(options, 'limit', 1, QUERY_LIMIT_MAXIMUM);
}

function parseCursor(
  options: CliOptionValues,
  timestampName: 'cursor-updated-at' | 'cursor-retired-at'
): Readonly<{ timestamp: number; sessionId: string }> | undefined {
  const timestamp = optionalSafeIntegerCliOption(options, timestampName);
  const sessionId = optionalCliOption(options, 'cursor-session-id');
  if ((timestamp === undefined) !== (sessionId === undefined)) {
    throw new AgentBaseCliError(
      'CLI_USAGE_INVALID',
      `Options --${timestampName} and --cursor-session-id must be provided together.`
    );
  }
  return timestamp === undefined || sessionId === undefined
    ? undefined
    : Object.freeze({ timestamp, sessionId });
}

export function parseAgentBaseCliSessionLifecycleCommand(
  action: string | undefined,
  optionTokens: readonly string[]
): AgentBaseCliSessionLifecycleCommand {
  const options = parseCliOptions(optionTokens, BOOLEAN_OPTIONS);
  if (action === 'list') {
    assertAllowedCliOptions(options, [
      'root',
      'agent-id',
      'limit',
      'cursor-updated-at',
      'cursor-session-id',
    ]);
    const cursor = parseCursor(options, 'cursor-updated-at');
    const limit = optionalLimit(options);
    return Object.freeze({
      kind: 'session-lifecycle-list',
      ...scope(options),
      ...(cursor === undefined
        ? {}
        : { cursor: Object.freeze({ updatedAt: cursor.timestamp, sessionId: cursor.sessionId }) }),
      ...(limit === undefined ? {} : { limit }),
    });
  }
  if (action === 'list-retired') {
    assertAllowedCliOptions(options, [
      'root',
      'agent-id',
      'limit',
      'cursor-retired-at',
      'cursor-session-id',
    ]);
    const cursor = parseCursor(options, 'cursor-retired-at');
    const limit = optionalLimit(options);
    return Object.freeze({
      kind: 'session-lifecycle-list-retired',
      ...scope(options),
      ...(cursor === undefined
        ? {}
        : { cursor: Object.freeze({ retiredAt: cursor.timestamp, sessionId: cursor.sessionId }) }),
      ...(limit === undefined ? {} : { limit }),
    });
  }
  if (action === 'inspect') {
    assertAllowedCliOptions(options, ['root', 'agent-id', 'session-id']);
    return Object.freeze({
      kind: 'session-lifecycle-inspect',
      ...scope(options),
      sessionId: requireCliOption(options, 'session-id'),
    });
  }
  if (action === 'turns') {
    assertAllowedCliOptions(options, ['root', 'agent-id', 'session-id', 'before-turn-id', 'limit']);
    const beforeTurnId = optionalCliOption(options, 'before-turn-id');
    const limit = optionalLimit(options);
    return Object.freeze({
      kind: 'session-lifecycle-turns',
      ...scope(options),
      sessionId: requireCliOption(options, 'session-id'),
      ...(beforeTurnId === undefined ? {} : { beforeTurnId }),
      ...(limit === undefined ? {} : { limit }),
    });
  }
  if (action === 'retire' || action === 'restore') {
    assertAllowedCliOptions(options, ['root', 'agent-id', 'session-id', 'expected-revision']);
    return Object.freeze({
      kind: action === 'retire' ? 'session-lifecycle-retire' : 'session-lifecycle-restore',
      ...scope(options),
      sessionId: requireCliOption(options, 'session-id'),
      expectedRevision: requireSafeIntegerCliOption(options, 'expected-revision'),
    });
  }
  if (action === 'purge') {
    assertAllowedCliOptions(options, [
      'root',
      'agent-id',
      'session-id',
      'expected-revision',
      'confirm-permanent-delete',
    ]);
    requireBooleanCliOption(options, 'confirm-permanent-delete');
    return Object.freeze({
      kind: 'session-lifecycle-purge',
      ...scope(options),
      sessionId: requireCliOption(options, 'session-id'),
      expectedRevision: requireSafeIntegerCliOption(options, 'expected-revision'),
    });
  }
  if (action === 'recover') {
    assertAllowedCliOptions(options, [
      'root',
      'agent-id',
      'session-id',
      'expected-execution-revision',
    ]);
    return Object.freeze({
      kind: 'session-lifecycle-recover',
      ...scope(options),
      sessionId: requireCliOption(options, 'session-id'),
      expectedExecutionRevision: requireSafeIntegerCliOption(
        options,
        'expected-execution-revision'
      ),
    });
  }
  throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown Session lifecycle command.');
}

export function isAgentBaseCliSessionLifecycleCommand(
  command: Readonly<{ kind: string }>
): command is AgentBaseCliSessionLifecycleCommand {
  return command.kind.startsWith('session-lifecycle-');
}
