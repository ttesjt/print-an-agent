import { AgentBaseCliError } from './errors.js';
import type { AgentBaseCliRuntimeLocator } from './contracts.js';

type OptionValues = ReadonlyMap<string, string | true>;

export type AgentBaseCliCommand =
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

const BOOLEAN_OPTIONS = new Set(['message-stdin']);

function parseOptions(tokens: readonly string[]): OptionValues {
  const values = new Map<string, string | true>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !token.startsWith('--') || token.length === 2) {
      throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Command options must use --name syntax.');
    }
    const name = token.slice(2);
    if (values.has(name)) {
      throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} cannot be repeated.`);
    }
    if (BOOLEAN_OPTIONS.has(name)) {
      values.set(name, true);
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} requires a value.`);
    }
    values.set(name, value);
    index += 1;
  }
  return values;
}

function requireOption(options: OptionValues, name: string): string {
  const value = options.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} is required.`);
  }
  return value;
}

function optionalOption(options: OptionValues, name: string): string | undefined {
  const value = options.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} requires a value.`);
  }
  return value;
}

function parseRevision(options: OptionValues, minimum = 0): number {
  const raw = requireOption(options, 'expected-revision');
  const revision = Number(raw);
  if (!Number.isSafeInteger(revision) || revision < minimum || String(revision) !== raw) {
    throw new AgentBaseCliError(
      'CLI_USAGE_INVALID',
      `Option --expected-revision must be a safe integer greater than or equal to ${minimum}.`
    );
  }
  return revision;
}

function parseRuntimeLocator(options: OptionValues): AgentBaseCliRuntimeLocator {
  const configPath = optionalOption(options, 'config');
  const rootDirectory = optionalOption(options, 'root');
  const agentId = optionalOption(options, 'agent-id');
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

function assertAllowedOptions(options: OptionValues, allowed: readonly string[]): void {
  const unexpected = [...options.keys()].find((name) => !allowed.includes(name));
  if (unexpected !== undefined) {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${unexpected} is not supported.`);
  }
}

export function parseAgentBaseCliCommand(argv: readonly string[]): AgentBaseCliCommand {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
    return Object.freeze({ kind: 'help' });
  }
  const [group, action, ...optionTokens] = argv;
  if (group === 'run') {
    const options = parseOptions(argv.slice(1));
    assertAllowedOptions(options, [
      'config',
      'root',
      'agent-id',
      'message',
      'message-stdin',
      'session-id',
      'idempotency-key',
    ]);
    const message = optionalOption(options, 'message');
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
    const sessionId = optionalOption(options, 'session-id');
    const idempotencyKey = optionalOption(options, 'idempotency-key');
    return Object.freeze({
      ...base,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
  }

  const options = parseOptions(optionTokens);
  if (group === 'agent') {
    if (action === 'create') {
      assertAllowedOptions(options, ['root', 'manifest']);
      return Object.freeze({
        kind: 'agent-create',
        rootDirectory: requireOption(options, 'root'),
        manifestPath: requireOption(options, 'manifest'),
      });
    }
    if (action === 'list') {
      assertAllowedOptions(options, ['root']);
      return Object.freeze({ kind: 'agent-list', rootDirectory: requireOption(options, 'root') });
    }
    if (action === 'inspect') {
      assertAllowedOptions(options, ['root', 'agent-id']);
      return Object.freeze({
        kind: 'agent-inspect',
        rootDirectory: requireOption(options, 'root'),
        agentId: requireOption(options, 'agent-id'),
      });
    }
    if (action === 'disable' || action === 'reactivate') {
      assertAllowedOptions(options, ['root', 'agent-id', 'expected-revision']);
      return Object.freeze({
        kind: action === 'disable' ? 'agent-disable' : 'agent-reactivate',
        rootDirectory: requireOption(options, 'root'),
        agentId: requireOption(options, 'agent-id'),
        expectedRevision: parseRevision(options, 1),
      });
    }
    throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown Agent lifecycle command.');
  }
  if (group === 'provider' && action === 'check') {
    assertAllowedOptions(options, ['config', 'root', 'agent-id']);
    return Object.freeze({ kind: 'provider-check', runtime: parseRuntimeLocator(options) });
  }
  if (group !== 'session') {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown command.');
  }
  if (action === 'compact') {
    assertAllowedOptions(options, ['config', 'root', 'agent-id', 'session-id', 'branch-id']);
    const branchId = optionalOption(options, 'branch-id');
    return Object.freeze({
      kind: 'session-compact' as const,
      runtime: parseRuntimeLocator(options),
      sessionId: requireOption(options, 'session-id'),
      ...(branchId === undefined ? {} : { branchId }),
    });
  }
  if (action === 'inspect') {
    assertAllowedOptions(options, ['config', 'root', 'agent-id', 'session-id']);
    return Object.freeze({
      kind: 'session-inspect',
      runtime: parseRuntimeLocator(options),
      sessionId: requireOption(options, 'session-id'),
    });
  }
  if (action === 'select') {
    assertAllowedOptions(options, [
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
      sessionId: requireOption(options, 'session-id'),
      branchId: requireOption(options, 'branch-id'),
      expectedRevision: parseRevision(options),
    });
  }
  if (action === 'fork') {
    assertAllowedOptions(options, [
      'config',
      'root',
      'agent-id',
      'session-id',
      'source-branch-id',
      'through-turn-id',
      'new-branch-id',
      'expected-revision',
    ]);
    const newBranchId = optionalOption(options, 'new-branch-id');
    return Object.freeze({
      kind: 'session-fork' as const,
      runtime: parseRuntimeLocator(options),
      sessionId: requireOption(options, 'session-id'),
      sourceBranchId: requireOption(options, 'source-branch-id'),
      throughTurnId: requireOption(options, 'through-turn-id'),
      expectedRevision: parseRevision(options),
      ...(newBranchId === undefined ? {} : { newBranchId }),
    });
  }
  if (action === 'rewind') {
    assertAllowedOptions(options, [
      'config',
      'root',
      'agent-id',
      'session-id',
      'through-turn-id',
      'new-branch-id',
      'expected-revision',
    ]);
    const newBranchId = optionalOption(options, 'new-branch-id');
    return Object.freeze({
      kind: 'session-rewind' as const,
      runtime: parseRuntimeLocator(options),
      sessionId: requireOption(options, 'session-id'),
      throughTurnId: requireOption(options, 'through-turn-id'),
      expectedRevision: parseRevision(options),
      ...(newBranchId === undefined ? {} : { newBranchId }),
    });
  }
  throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Unknown session command.');
}
