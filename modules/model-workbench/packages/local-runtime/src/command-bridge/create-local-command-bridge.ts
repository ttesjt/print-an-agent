import { spawn } from 'node:child_process';
import { constants as fileConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CapabilityDispatchKind } from '@print-an-agent/workbench-extension';
import type { ExtensionCallOptions } from '@print-an-agent/workbench-extension';

import {
  LOCAL_EXECUTION_SUPERVISOR_READY_FILE,
  LOCAL_SUPERVISOR_POLL_MILLISECONDS,
} from '../foundation/constants.js';
import { LocalCommandDispatchError } from '../foundation/errors.js';
import { defineLocalExecutionReceipt } from '../execution/local-execution-receipt.js';
import { resolveLocalCommandConfiguration } from './command-configuration.js';
import type { LocalCommandBridge, LocalCommandBridgeOptions } from './contracts.js';
import { prepareLocalCommandWorkspace } from './workspace.js';

export function createLocalCommandBridge(options: LocalCommandBridgeOptions): LocalCommandBridge {
  const configuration = resolveLocalCommandConfiguration(options);

  return Object.freeze({
    async dispatch(request: unknown, callOptions?: ExtensionCallOptions) {
      assertNotAborted(callOptions?.signal);
      const workspace = await prepareLocalCommandWorkspace(configuration, request);
      assertNotAborted(callOptions?.signal);
      const supervisorEntry = await resolveSupervisorEntry();
      await launchDetachedSupervisor(
        supervisorEntry,
        workspace.executionDirectory,
        workspace.environment
      );
      await waitForSupervisor(
        workspace.executionDirectory,
        configuration.supervisorStartupTimeoutMilliseconds,
        callOptions?.signal
      );
      return Object.freeze({
        kind: CapabilityDispatchKind.Accepted,
        executionReceipt: defineLocalExecutionReceipt({
          executionId: workspace.executionId,
        }),
      });
    },
  });
}

async function launchDetachedSupervisor(
  supervisorEntry: string,
  executionDirectory: string,
  environment: Readonly<Record<string, string>>
): Promise<void> {
  try {
    const child = spawn(process.execPath, [supervisorEntry, executionDirectory], {
      detached: true,
      env: environment,
      stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => {
      const spawned = (): void => {
        child.removeListener('error', failed);
        resolve();
      };
      const failed = (cause: Error): void => {
        child.removeListener('spawn', spawned);
        reject(cause);
      };
      child.once('spawn', spawned);
      child.once('error', failed);
    });
    child.unref();
  } catch (cause: unknown) {
    throw new LocalCommandDispatchError('Could not launch the local execution supervisor.', {
      cause,
    });
  }
}

async function resolveSupervisorEntry(): Promise<string> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDirectory, '..', 'supervisor', 'supervisor-entry.js'),
    join(moduleDirectory, '..', '..', 'dist', 'supervisor', 'supervisor-entry.js'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, fileConstants.R_OK);
      return candidate;
    } catch {
      // Try the source-tree fallback used by package integration tests.
    }
  }
  throw new LocalCommandDispatchError(
    'The compiled local supervisor entry could not be found. Build the local-runtime package first.'
  );
}

async function waitForSupervisor(
  executionDirectory: string,
  timeoutMilliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  const readyPath = join(executionDirectory, LOCAL_EXECUTION_SUPERVISOR_READY_FILE);
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    assertNotAborted(signal);
    try {
      await access(readyPath, fileConstants.F_OK);
      return;
    } catch {
      await delay(LOCAL_SUPERVISOR_POLL_MILLISECONDS, signal);
    }
  }
  throw new LocalCommandDispatchError('The local execution supervisor did not become ready.');
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  const error = new Error('Local command dispatch was aborted.', { cause: signal.reason });
  error.name = 'AbortError';
  return error;
}
