import { AgentBaseCliError } from './errors.js';
import type { AgentBaseCliRuntimeLocator } from './contracts.js';
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
      runtime: AgentBaseCliRuntimeLocator;
      sessionId: string;
      branchId?: string;
    }>
  | Readonly<{
      kind: 'session-inspect';
      runtime: AgentBaseCliRuntimeLocator;
      sessionId: string;
    }>
  | Readonly<{
      kind: 'session-select';
      runtime: AgentBaseCliRuntimeLocator;
      sessionId: string;
      branchId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      kind: 'session-fork';
      runtime: AgentBaseCliRuntimeLocator;
      sessionId: string;
      sourceBranchId: string;
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>
  | Readonly<{
      kind: 'session-rewind';
      runtime: AgentBaseCliRuntimeLocator;
      sessionId: string;
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>
  | Readonly<{ kind: 'agent-create'; rootDirectory: string; manifestPath: string }>
  | Readonly<{ kind: 'agent-list'; rootDirectory: string }>
  | Readonly<{ kind: 'agent-inspect'; rootDirectory: string; agentId: string }>
  | Readonly<{
      kind: 'agent-disable';
      rootDirectory: string;
      agentId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      kind: 'agent-reactivate';
      rootDirectory: string;
      agentId: string;
      expectedRevision: number;
    }>;

const RUN_BOOLEAN_OPTIONS = new Set(['message-stdin']);

function parseRevision(options: CliOptionValues, minimum = 0): number {
  return requireSafeIntegerCliOption(options, 'expected-revision', minimum);
}

function parseRuntimeLocator(options: CliOptionValues): AgentBaseCliRuntimeLocator {
  const configPath = optionalCliOption(options, 'config');
  const rootDirectory = optionalCliOption(options, 'root');
  const agentId = optionalCliOption(options, 'agent-id');
  if (configPath !== undefined) {
    if (rootDirectory !== undefined || agentId !== undefined) {
      throw new AgentBaseCliError(
        'CLI_USAGE_INVALID',
        '--config cannot be combined with --root or --agent-id.'
      );
    }
    return Object.freeze({ kind: 'config', configPath });
  }
  if (rootDirectory === undefined || agentId === undefined) {
    throw new AgentBaseCliError(
      'CLI_USAGE_INVALID',
      'Either --config or both --root and --agent-id are required.'
    );
  }
  return Object.freeze({ kind: 'managed', rootDirectory, agentId });
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
    const base = {
      kind: 'run' as const,
      runtime: parseRuntimeLocator(options),
      messageSource:
        message === undefined
          ? ({ kind: 'stdin' } as const)
          : ({ kind: 'argument', value: message } as const),
    };
    const sessionId = optionalCliOption(options, 'session-id');
    const idempotencyKey = optionalCliOption(options, 'idempotency-key');
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
      assertAllowedCliOptions(options, ['root', 'manifest']);
      return Object.freeze({
        kind: 'agent-create',
        rootDirectory: requireCliOption(options, 'root'),
        manifestPath: requireCliOption(options, 'manifest'),
      });
    }
    if (action === 'list') {
      assertAllowedCliOptions(options, ['root']);
      return Object.freeze({
        kind: 'agent-list',
        rootDirectory: requireCliOption(options, 'root'),
      });
    }
    if (action === 'inspect') {
      assertAllowedCliOptions(options, ['root', 'agent-id']);
      return Object.freeze({
        kind: 'agent-inspect',
        rootDirectory: requireCliOption(options, 'root'),
        agentId: requireCliOption(options, 'agent-id'),
      });
    }
    if (action === 'disable' || action === 'reactivate') {
      assertAllowedCliOptions(options, ['root', 'agent-id', 'expected-revision']);
      return Object.freeze({
        kind: action === 'disable' ? 'agent-disable' : 'agent-reactivate',
        rootDirectory: requireCliOption(options, 'root'),
        agentId: requireCliOption(options, 'agent-id'),
        expectedRevision: parseRevision(options, 1),
      });
    }
    throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown Agent lifecycle command.');
  }
  if (group === 'provider' && action === 'check') {
    assertAllowedCliOptions(options, ['config', 'root', 'agent-id']);
    return Object.freeze({ kind: 'provider-check', runtime: parseRuntimeLocator(options) });
  }
  if (group !== 'session') {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown command.');
  }
  if (action === 'compact') {
    assertAllowedCliOptions(options, ['config', 'root', 'agent-id', 'session-id', 'branch-id']);
    const branchId = optionalCliOption(options, 'branch-id');
    return Object.freeze({
      kind: 'session-compact' as const,
      runtime: parseRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
      ...(branchId === undefined ? {} : { branchId }),
    });
  }
  if (action === 'inspect') {
    assertAllowedCliOptions(options, ['config', 'root', 'agent-id', 'session-id']);
    return Object.freeze({
      kind: 'session-inspect',
      runtime: parseRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
    });
  }
  if (action === 'select') {
    assertAllowedCliOptions(options, [
      'config',
      'root',
      'agent-id',
      'session-id',
      'branch-id',
      'expected-revision',
    ]);
    return Object.freeze({
      kind: 'session-select',
      runtime: parseRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
      branchId: requireCliOption(options, 'branch-id'),
      expectedRevision: parseRevision(options),
    });
  }
  if (action === 'fork') {
    assertAllowedCliOptions(options, [
      'config',
      'root',
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
      runtime: parseRuntimeLocator(options),
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
      'agent-id',
      'session-id',
      'through-turn-id',
      'new-branch-id',
      'expected-revision',
    ]);
    const newBranchId = optionalCliOption(options, 'new-branch-id');
    return Object.freeze({
      kind: 'session-rewind' as const,
      runtime: parseRuntimeLocator(options),
      sessionId: requireCliOption(options, 'session-id'),
      throughTurnId: requireCliOption(options, 'through-turn-id'),
      expectedRevision: parseRevision(options),
      ...(newBranchId === undefined ? {} : { newBranchId }),
    });
  }
  throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown session command.');
}
