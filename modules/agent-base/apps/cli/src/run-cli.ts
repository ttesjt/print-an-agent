import { AgentBaseCliError } from './errors.js';
import { parseAgentBaseCliCommand, type AgentBaseCliCommand } from './parse-command.js';
import type { AgentBaseCliDependencies } from './contracts.js';

export const AGENT_BASE_CLI_USAGE = `Usage:
  agent-base agent create --root <dir> --manifest <file>
  agent-base agent list --root <dir>
  agent-base agent inspect --root <dir> --agent-id <id>
  agent-base agent disable --root <dir> --agent-id <id> --expected-revision <n>
  agent-base agent reactivate --root <dir> --agent-id <id> --expected-revision <n>
  agent-base provider check (--config <file> | --root <dir> --agent-id <id>)
  agent-base run (--config <file> | --root <dir> --agent-id <id>) (--message <text> | --message-stdin) [--session-id <id>] [--idempotency-key <key>]
  agent-base session compact (--config <file> | --root <dir> --agent-id <id>) --session-id <id> [--branch-id <id>]
  agent-base session inspect (--config <file> | --root <dir> --agent-id <id>) --session-id <id>
  agent-base session select (--config <file> | --root <dir> --agent-id <id>) --session-id <id> --branch-id <id> --expected-revision <n>
  agent-base session fork (--config <file> | --root <dir> --agent-id <id>) --session-id <id> --source-branch-id <id> --through-turn-id <id> --expected-revision <n> [--new-branch-id <id>]
  agent-base session rewind (--config <file> | --root <dir> --agent-id <id>) --session-id <id> --through-turn-id <id> --expected-revision <n> [--new-branch-id <id>]
`;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'UNEXPECTED_RUNTIME_FAILURE';
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'UNEXPECTED_RUNTIME_FAILURE';
}

function isCredentialUnavailable(value: unknown): boolean {
  return isRecord(value) && value.status === 'credential-unavailable';
}

async function writeJson(dependencies: AgentBaseCliDependencies, value: unknown): Promise<void> {
  await dependencies.standardOutput.write(`${JSON.stringify(value)}\n`);
}

async function executeCommand(
  command: Exclude<AgentBaseCliCommand, Readonly<{ kind: 'help' }>>,
  dependencies: AgentBaseCliDependencies
): Promise<number> {
  const signal = dependencies.signal;
  if (
    command.kind === 'agent-create' ||
    command.kind === 'agent-list' ||
    command.kind === 'agent-inspect' ||
    command.kind === 'agent-disable' ||
    command.kind === 'agent-reactivate'
  ) {
    const directory = await dependencies.loadManagedDirectory(command.rootDirectory);
    if (command.kind === 'agent-create') {
      await writeJson(
        dependencies,
        await directory.create(await dependencies.readJsonDocument(command.manifestPath))
      );
      return 0;
    }
    if (command.kind === 'agent-list') {
      await writeJson(dependencies, await directory.list());
      return 0;
    }
    if (command.kind === 'agent-inspect') {
      await writeJson(dependencies, await directory.inspect(command.agentId));
      return 0;
    }
    if (command.kind === 'agent-disable') {
      await writeJson(
        dependencies,
        await directory.disable(command.agentId, command.expectedRevision)
      );
      return 0;
    }
    await writeJson(
      dependencies,
      await directory.reactivate(command.agentId, command.expectedRevision)
    );
    return 0;
  }
  const runtime = await dependencies.loadRuntime(command.runtime);
  if (command.kind === 'provider-check') {
    const outcome = await runtime.checkProvider(signal);
    await writeJson(dependencies, outcome);
    return isCredentialUnavailable(outcome) ? 3 : 0;
  }
  if (command.kind === 'run') {
    const message =
      command.messageSource.kind === 'argument'
        ? command.messageSource.value
        : await dependencies.readStandardInput(signal);
    if (message.length === 0) {
      throw new AgentBaseCliError('CLI_INPUT_INVALID', 'Run message cannot be empty.');
    }
    await runtime.run(
      {
        message,
        ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }),
        ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
      },
      {
        signal,
        writeTextDelta: (delta) => dependencies.standardOutput.write(delta),
        sessionOpened: (sessionId) =>
          command.sessionId === undefined
            ? dependencies.standardError.write(
                `${JSON.stringify({ type: 'session-created', sessionId })}\n`
              )
            : Promise.resolve(),
      }
    );
    await dependencies.standardOutput.write('\n');
    return 0;
  }
  if (command.kind === 'session-compact') {
    await writeJson(
      dependencies,
      await runtime.compactSession(
        {
          sessionId: command.sessionId,
          ...(command.branchId === undefined ? {} : { branchId: command.branchId }),
        },
        signal
      )
    );
    return 0;
  }
  if (command.kind === 'session-inspect') {
    await writeJson(dependencies, await runtime.inspectSession(command.sessionId, signal));
    return 0;
  }
  if (command.kind === 'session-select') {
    await writeJson(
      dependencies,
      await runtime.selectSessionBranch(
        {
          sessionId: command.sessionId,
          branchId: command.branchId,
          expectedRevision: command.expectedRevision,
        },
        signal
      )
    );
    return 0;
  }
  if (command.kind === 'session-fork') {
    await writeJson(
      dependencies,
      await runtime.forkSessionBranch(
        {
          sessionId: command.sessionId,
          sourceBranchId: command.sourceBranchId,
          throughTurnId: command.throughTurnId,
          expectedRevision: command.expectedRevision,
          ...(command.newBranchId === undefined ? {} : { newBranchId: command.newBranchId }),
        },
        signal
      )
    );
    return 0;
  }
  await writeJson(
    dependencies,
    await runtime.rewindSession(
      {
        sessionId: command.sessionId,
        throughTurnId: command.throughTurnId,
        expectedRevision: command.expectedRevision,
        ...(command.newBranchId === undefined ? {} : { newBranchId: command.newBranchId }),
      },
      signal
    )
  );
  return 0;
}

export async function runAgentBaseCli(
  argv: readonly string[],
  dependencies: AgentBaseCliDependencies
): Promise<number> {
  try {
    const command = parseAgentBaseCliCommand(argv);
    if (command.kind === 'help') {
      await dependencies.standardOutput.write(AGENT_BASE_CLI_USAGE);
      return 0;
    }
    return await executeCommand(command, dependencies);
  } catch (error: unknown) {
    if (dependencies.signal.aborted) return 130;
    if (
      error instanceof AgentBaseCliError ||
      safeErrorCode(error) === 'STANDALONE_CONFIG_INVALID'
    ) {
      await dependencies.standardError.write(
        `Agent Base CLI input rejected (${safeErrorCode(error)}).\n`
      );
      return 2;
    }
    const code = safeErrorCode(error);
    if (code === 'MODEL_CREDENTIAL_NOT_FOUND') {
      await dependencies.standardError.write(`Agent Base provider unavailable (${code}).\n`);
      return 3;
    }
    await dependencies.standardError.write(`Agent Base command failed (${code}).\n`);
    return 1;
  }
}
