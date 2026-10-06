import { AgentBaseCliError } from './errors.js';
import type {
  AgentBaseCliDurableRuntimeLocator,
  AgentBaseCliRuntimeLocator,
  AgentBaseCliStorageLocator,
} from './contracts.js';
import {
  assertAllowedCliOptions,
  optionalCliOption,
  parseCliOptions,
  requireCliOption,
  requireSafeIntegerCliOption,
  type CliOptionValues,
} from './option-parser.js';
import {
  parseAgentBaseCliSessionLifecycleCommand,
  type AgentBaseCliSessionLifecycleCommand,
} from './session-lifecycle-command.js';

export type AgentBaseCliCommand =
  | AgentBaseCliSessionLifecycleCommand
  | Readonly<{ kind: 'help' }>
  | Readonly<{ kind: 'provider-check'; runtime: AgentBaseCliRuntimeLocator }>
  | Readonly<{
      kind: 'run';
      runtime: AgentBaseCliRuntimeLocator;
      messageSource: Readonly<{ kind: 'argument'; value: string }> | Readonly<{ kind: 'stdin' }>;
      sessionId?: string;
      idempotencyKey?: string;
    }>
  | Readonly<{
      kind: 'session-compact';
      runtime: AgentBaseCliDurableRuntimeLocator;
      sessionId: string;
      branchId?: string;
    }>
  | Readonly<{
      kind: 'session-inspect';
      runtime: AgentBaseCliDurableRuntimeLocator;
      sessionId: string;
    }>
  | Readonly<{
      kind: 'session-select';
      runtime: AgentBaseCliDurableRuntimeLocator;
      sessionId: string;
      branchId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      kind: 'session-fork';
      runtime: AgentBaseCliDurableRuntimeLocator;
      sessionId: string;
      sourceBranchId: string;
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>
  | Readonly<{
      kind: 'session-rewind';
      runtime: AgentBaseCliDurableRuntimeLocator;
      sessionId: string;
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>
  | Readonly<{ kind: 'agent-create'; storage: AgentBaseCliStorageLocator; manifestPath: string }>
  | Readonly<{ kind: 'agent-list'; storage: AgentBaseCliStorageLocator }>
  | Readonly<{ kind: 'agent-inspect'; storage: AgentBaseCliStorageLocator; agentId: string }>
  | Readonly<{
      kind: 'agent-disable';
      storage: AgentBaseCliStorageLocator;
      agentId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      kind: 'agent-reactivate';
      storage: AgentBaseCliStorageLocator;
      agentId: string;
      expectedRevision: number;
    }>;

const RUN_BOOLEAN_OPTIONS = new Set(['message-stdin']);

function parseRevision(options: CliOptionValues, minimum = 0): number {
  return requireSafeIntegerCliOption(options, 'expected-revision', minimum);
}

function parseRuntimeLocator(options: CliOptionValues): AgentBaseCliRuntimeLocator {
  const configPath = optionalCliOption(options, 'config');
  if (configPath !== undefined) {
    if (['root', 'database-path', 'agent-id'].some((key) => options.has(key))) {
      throw new AgentBaseCliError(
        'CLI_USAGE_INVALID',
        '--config cannot be combined with a storage locator or --agent-id.'
      );
    }
    return Object.freeze({ kind: 'config', configPath });
  }
  return Object.freeze({
    ...parseStorageLocator(options),
    agentId: requireCliOption(options, 'agent-id'),
  });
}

function parseStorageLocator(options: CliOptionValues): AgentBaseCliStorageLocator {
  const rootDirectory = optionalCliOption(options, 'root');
  const databasePath = optionalCliOption(options, 'database-path');
  if ((rootDirectory === undefined) === (databasePath === undefined)) {
    throw new AgentBaseCliError(
      'CLI_USAGE_INVALID',
      'Exactly one of --root or --database-path is required.'
    );
  }
  return databasePath === undefined
    ? Object.freeze({ kind: 'directory', rootDirectory: requireCliOption(options, 'root') })
    : Object.freeze({ kind: 'sqlite', databasePath });
}

function parseDurableRuntimeLocator(options: CliOptionValues): AgentBaseCliDurableRuntimeLocator {
  const locator = parseRuntimeLocator(options);
  if (locator.kind === 'config') {
    throw new AgentBaseCliError(
      'CLI_USAGE_INVALID',
      'Existing Session commands require --root or --database-path with --agent-id.'
    );
  }
  return locator;
}

export function parseAgentBaseCliCommand(argv: readonly string[]): AgentBaseCliCommand {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
    return Object.freeze({ kind: 'help' });
  }
  const [group, action, ...optionTokens] = argv;
  if (group === 'run') {
    const options = parseCliOptions(argv.slice(1), RUN_BOOLEAN_OPTIONS);
    assertAllowedCliOptions(options, [
      'config',
      'root',
      'database-path',
      'agent-id',
      'message',
      'message-stdin',
      'session-id',
      'idempotency-key',
    ]);
    const message = optionalCliOption(options, 'message');
    const fromStandardInput = options.get('message-stdin') === true;
    if ((message === undefined) === !fromStandardInput) {
      throw new AgentBaseCliError(
        'CLI_USAGE_INVALID',
        'Exactly one of --message or --message-stdin is required.'
      );
    }
    const runtime = parseRuntimeLocator(options);
    const sessionId = optionalCliOption(options, 'session-id');
    const idempotencyKey = optionalCliOption(options, 'idempotency-key');
    if (runtime.kind === 'config' && (sessionId !== undefined || idempotencyKey !== undefined)) {
      throw new AgentBaseCliError(
        'CLI_USAGE_INVALID',
        'Memory --config runs must create a new Session and cannot specify replay identity.'
      );
    }
    const base = {
      kind: 'run' as const,
      runtime,
      messageSource:
        message === undefined
          ? ({ kind: 'stdin' } as const)
          : ({ kind: 'argument', value: message } as const),
    };
    return Object.freeze({
      ...base,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
  }

  if (group === 'session' && action === 'lifecycle') {
    const [lifecycleAction, ...lifecycleOptionTokens] = optionTokens;
    return parseAgentBaseCliSessionLifecycleCommand(lifecycleAction, lifecycleOptionTokens);
  }

  const options = parseCliOptions(optionTokens);
  if (group === 'agent') {
    if (action === 'create') {
      assertAllowedCliOptions(options, ['root', 'database-path', 'manifest']);
      return Object.freeze({
        kind: 'agent-create',
        storage: parseStorageLocator(options),
        manifestPath: requireCliOption(options, 'manifest'),
      });
    }
    if (action === 'list') {
      assertAllowedCliOptions(options, ['root', 'database-path']);
      return Object.freeze({
        kind: 'agent-list',
        storage: parseStorageLocator(options),
      });
    }
    if (action === 'inspect') {
      assertAllowedCliOptions(options, ['root', 'database-path', 'agent-id']);
      return Object.freeze({
        kind: 'agent-inspect',
        storage: parseStorageLocator(options),
        agentId: requireCliOption(options, 'agent-id'),
      });
    }
    if (action === 'disable' || action === 'reactivate') {
      assertAllowedCliOptions(options, ['root', 'database-path', 'agent-id', 'expected-revision']);
      return Object.freeze({
        kind: action === 'disable' ? 'agent-disable' : 'agent-reactivate',
        storage: parseStorageLocator(options),
        agentId: requireCliOption(options, 'agent-id'),
        expectedRevision: parseRevision(options, 1),
      });
    }
    throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown Agent lifecycle command.');
  }
  if (group === 'provider' && action === 'check') {
    assertAllowedCliOptions(options, ['config', 'root', 'database-path', 'agent-id']);
    return Object.freeze({ kind: 'provider-check', runtime: parseRuntimeLocator(options) });
  }
  if (group !== 'session') {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown command.');
  }
  if (action === 'compact') {
    assertAllowedCliOptions(options, [
      'config',
      'root',
      'database-path',
      'agent-id',
      'session-id',
      'branch-id',
    ]);
    const branchId = optionalCliOption(options, 'branch-id');
    return Object.freeze({
      kind: 'session-compact' as const,
      runtime: parseDurableRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
      ...(branchId === undefined ? {} : { branchId }),
    });
  }
  if (action === 'inspect') {
    assertAllowedCliOptions(options, ['config', 'root', 'database-path', 'agent-id', 'session-id']);
    return Object.freeze({
      kind: 'session-inspect',
      runtime: parseDurableRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
    });
  }
  if (action === 'select') {
    assertAllowedCliOptions(options, [
      'config',
      'root',
      'database-path',
      'agent-id',
      'session-id',
      'branch-id',
      'expected-revision',
    ]);
    return Object.freeze({
      kind: 'session-select',
      runtime: parseDurableRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
      branchId: requireCliOption(options, 'branch-id'),
      expectedRevision: parseRevision(options),
    });
  }
  if (action === 'fork') {
    assertAllowedCliOptions(options, [
      'config',
      'root',
      'database-path',
      'agent-id',
      'session-id',
      'source-branch-id',
      'through-turn-id',
      'new-branch-id',
      'expected-revision',
    ]);
    const newBranchId = optionalCliOption(options, 'new-branch-id');
    return Object.freeze({
      kind: 'session-fork' as const,
      runtime: parseDurableRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
      sourceBranchId: requireCliOption(options, 'source-branch-id'),
      throughTurnId: requireCliOption(options, 'through-turn-id'),
      expectedRevision: parseRevision(options),
      ...(newBranchId === undefined ? {} : { newBranchId }),
    });
  }
  if (action === 'rewind') {
    assertAllowedCliOptions(options, [
      'config',
      'root',
      'database-path',
      'agent-id',
      'session-id',
      'through-turn-id',
      'new-branch-id',
      'expected-revision',
    ]);
    const newBranchId = optionalCliOption(options, 'new-branch-id');
    return Object.freeze({
      kind: 'session-rewind' as const,
      runtime: parseDurableRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
      throughTurnId: requireCliOption(options, 'through-turn-id'),
      expectedRevision: parseRevision(options),
      ...(newBranchId === undefined ? {} : { newBranchId }),
    });
  }
  throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown session command.');
}
