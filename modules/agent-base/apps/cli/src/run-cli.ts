import { AgentBaseCliError } from './errors.js';
import { parseAgentBaseCliCommand, type AgentBaseCliCommand } from './parse-command.js';
import type { AgentBaseCliDependencies } from './contracts.js';
import {
  isAgentBaseCliSessionLifecycleCommand,
  type AgentBaseCliSessionLifecycleCommand,
} from './session-lifecycle-command.js';

export const AGENT_BASE_CLI_USAGE = `Usage:
  agent-base agent create (--root <dir> | --database-path <file>) --manifest <file>
  agent-base agent list (--root <dir> | --database-path <file>)
  agent-base agent inspect (--root <dir> | --database-path <file>) --agent-id <id>
  agent-base agent disable (--root <dir> | --database-path <file>) --agent-id <id> --expected-revision <n>
  agent-base agent reactivate (--root <dir> | --database-path <file>) --agent-id <id> --expected-revision <n>
  agent-base provider check (--config <memory-file> | (--root <dir> | --database-path <file>) --agent-id <id>)
  agent-base run --config <memory-file> (--message <text> | --message-stdin)
  agent-base run (--root <dir> | --database-path <file>) --agent-id <id> (--message <text> | --message-stdin) [--session-id <id>] [--idempotency-key <key>]
  agent-base session compact (--root <dir> | --database-path <file>) --agent-id <id> --session-id <id> [--branch-id <id>]
  agent-base session inspect (--root <dir> | --database-path <file>) --agent-id <id> --session-id <id>
  agent-base session select (--root <dir> | --database-path <file>) --agent-id <id> --session-id <id> --branch-id <id> --expected-revision <n>
  agent-base session fork (--root <dir> | --database-path <file>) --agent-id <id> --session-id <id> --source-branch-id <id> --through-turn-id <id> --expected-revision <n> [--new-branch-id <id>]
  agent-base session rewind (--root <dir> | --database-path <file>) --agent-id <id> --session-id <id> --through-turn-id <id> --expected-revision <n> [--new-branch-id <id>]
  agent-base session lifecycle list --root <dir> --agent-id <id> [--limit <n>] [--cursor-updated-at <timestamp> --cursor-session-id <id>]
  agent-base session lifecycle list-retired --root <dir> --agent-id <id> [--limit <n>] [--cursor-retired-at <timestamp> --cursor-session-id <id>]
  agent-base session lifecycle inspect --root <dir> --agent-id <id> --session-id <id>
  agent-base session lifecycle turns --root <dir> --agent-id <id> --session-id <id> [--before-turn-id <id>] [--limit <n>]
  agent-base session lifecycle retire --root <dir> --agent-id <id> --session-id <id> --expected-revision <n>
  agent-base session lifecycle restore --root <dir> --agent-id <id> --session-id <id> --expected-revision <n>
  agent-base session lifecycle purge --root <dir> --agent-id <id> --session-id <id> --expected-revision <n> --confirm-permanent-delete
  agent-base session lifecycle recover --root <dir> --agent-id <id> --session-id <id> --expected-execution-revision <n>
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

async function executeSessionLifecycleCommand(
  command: AgentBaseCliSessionLifecycleCommand,
  dependencies: AgentBaseCliDependencies
): Promise<number> {
  const manager = await dependencies.loadSessionManager(command.rootDirectory, command.agentId);
  if (command.kind === 'session-lifecycle-list') {
    await writeJson(
      dependencies,
      await manager.list({
        ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      })
    );
    return 0;
  }
  if (command.kind === 'session-lifecycle-list-retired') {
    await writeJson(
      dependencies,
      await manager.listRetired({
        ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      })
    );
    return 0;
  }
  if (command.kind === 'session-lifecycle-inspect') {
    await writeJson(dependencies, (await manager.inspect(command.sessionId)) ?? null);
    return 0;
  }
  if (command.kind === 'session-lifecycle-turns') {
    await writeJson(
      dependencies,
      (await manager.listTurns({
        sessionId: command.sessionId,
        ...(command.beforeTurnId === undefined ? {} : { beforeTurnId: command.beforeTurnId }),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      })) ?? null
    );
    return 0;
  }
  if (command.kind === 'session-lifecycle-retire') {
    await writeJson(
      dependencies,
      await manager.retire(command.sessionId, command.expectedRevision)
    );
    return 0;
  }
  if (command.kind === 'session-lifecycle-restore') {
    await writeJson(
      dependencies,
      await manager.restore(command.sessionId, command.expectedRevision)
    );
    return 0;
  }
  if (command.kind === 'session-lifecycle-purge') {
    await manager.purge(command.sessionId, command.expectedRevision);
    await writeJson(
      dependencies,
      Object.freeze({
        status: 'purged',
        agentId: command.agentId,
        sessionId: command.sessionId,
      })
    );
    return 0;
  }
  await writeJson(
    dependencies,
    await manager.recover(command.sessionId, command.expectedExecutionRevision)
  );
  return 0;
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
    const manager = await dependencies.loadAgentManager(command.storage);
    if (command.kind === 'agent-create') {
      await writeJson(
        dependencies,
        await manager.create(await dependencies.readJsonDocument(command.manifestPath))
      );
      return 0;
    }
    if (command.kind === 'agent-list') {
      await writeJson(dependencies, await manager.list());
      return 0;
    }
    if (command.kind === 'agent-inspect') {
      await writeJson(dependencies, await manager.inspect(command.agentId));
      return 0;
    }
    if (command.kind === 'agent-disable') {
      await writeJson(
        dependencies,
        await manager.disable(command.agentId, command.expectedRevision)
      );
      return 0;
    }
    await writeJson(
      dependencies,
      await manager.reactivate(command.agentId, command.expectedRevision)
    );
    return 0;
  }
  if (isAgentBaseCliSessionLifecycleCommand(command)) {
    return executeSessionLifecycleCommand(command, dependencies);
  }
  if (command.kind === 'provider-check') {
    const provider = await dependencies.loadProvider(command.runtime);
    const outcome = await provider.check(signal);
    await writeJson(dependencies, outcome);
    return isCredentialUnavailable(outcome) ? 3 : 0;
  }
  if (command.kind === 'run') {
    const runtime = await dependencies.loadRuntime(command.runtime);
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
    const runtime = await dependencies.loadRuntime(command.runtime);
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
  const navigation = await dependencies.loadSessionNavigator(command.agent);
  if (command.kind === 'session-inspect') {
    await writeJson(dependencies, await navigation.inspectSession(command.sessionId, signal));
    return 0;
  }
  if (command.kind === 'session-select') {
    await writeJson(
      dependencies,
      await navigation.selectSessionBranch(
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
      await navigation.forkSessionBranch(
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
    await navigation.rewindSession(
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
