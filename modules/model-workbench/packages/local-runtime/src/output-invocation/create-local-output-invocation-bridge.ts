import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { parseJsonValue } from '@print-an-agent/workbench-domain';
import {
  OutputInvocationKind,
  type ExtensionCallOptions,
} from '@print-an-agent/workbench-extension';

import { resolveLocalProcessCommand } from '../command-bridge/command-configuration.js';
import {
  DEFAULT_LOCAL_COMMAND_CANCELLATION_GRACE_MILLISECONDS,
  DEFAULT_MAXIMUM_LOCAL_COMMAND_MESSAGE_BYTES,
  DEFAULT_MAXIMUM_LOCAL_COMMAND_STDERR_BYTES,
  LocalOutputInvocationMessageKind,
} from '../foundation/constants.js';
import {
  InvalidLocalCommandConfigurationError,
  LocalOutputInvocationError,
} from '../foundation/errors.js';
import { BoundedLineDecoder } from '../supervisor/bounded-line-decoder.js';
import type {
  LocalOutputInvocationBridge,
  LocalOutputInvocationBridgeOptions,
} from './contracts.js';
import { parseLocalOutputInvocationMessage } from './protocol.js';
import {
  closeInvocationReader,
  createResultStream,
  type InvocationStreamProcess,
} from './result-stream.js';

export function createLocalOutputInvocationBridge(
  options: LocalOutputInvocationBridgeOptions
): LocalOutputInvocationBridge {
  const command = resolveLocalProcessCommand(options.command);
  const maximumProtocolMessageBytes = positiveInteger(
    options.maximumProtocolMessageBytes ?? DEFAULT_MAXIMUM_LOCAL_COMMAND_MESSAGE_BYTES,
    'maximumProtocolMessageBytes'
  );
  const maximumStderrBytes = nonNegativeInteger(
    options.maximumStderrBytes ?? DEFAULT_MAXIMUM_LOCAL_COMMAND_STDERR_BYTES,
    'maximumStderrBytes'
  );
  const cancellationGraceMilliseconds = nonNegativeInteger(
    options.cancellationGraceMilliseconds ?? DEFAULT_LOCAL_COMMAND_CANCELLATION_GRACE_MILLISECONDS,
    'cancellationGraceMilliseconds'
  );

  return Object.freeze({
    invoke: async (request: unknown, callOptions?: ExtensionCallOptions) => {
      assertNotAborted(callOptions?.signal);
      const child = spawn(command.executable, command.arguments, {
        ...(command.workingDirectory === undefined ? {} : { cwd: command.workingDirectory }),
        env: command.environment,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const process = manageProcess(
        child,
        maximumStderrBytes,
        cancellationGraceMilliseconds,
        callOptions
      );
      const lines = readLines(child, maximumProtocolMessageBytes)[Symbol.asyncIterator]();
      try {
        await process.spawned;
        await writeInvocationRequest(child, `${JSON.stringify(parseJsonValue(request))}\n`);
        const first = await lines.next();
        if (first.done === true) {
          await process.requireSuccess();
          throw new LocalOutputInvocationError('The local Output Invoker returned no result.');
        }
        const message = parseLocalOutputInvocationMessage(first.value);
        if (message.kind === LocalOutputInvocationMessageKind.Completed) {
          const extra = await lines.next();
          if (extra.done !== true) {
            throw new LocalOutputInvocationError(
              'A completed local Output Invocation must contain exactly one message.'
            );
          }
          await process.requireSuccess();
          return Object.freeze({ kind: OutputInvocationKind.Completed, result: message.result });
        }
        if (message.kind !== LocalOutputInvocationMessageKind.StreamStart) {
          throw new LocalOutputInvocationError(
            'A local Output Invocation must begin with completed or stream-start.'
          );
        }
        return Object.freeze({
          kind: OutputInvocationKind.Streaming,
          stream: createResultStream(lines, process),
        });
      } catch (cause: unknown) {
        try {
          await closeInvocationReader(lines, process);
        } catch (cleanupCause: unknown) {
          throw new AggregateError([cause, cleanupCause], 'Local invocation and cleanup failed.');
        }
        if (isAbortError(cause)) throw cause;
        if (cause instanceof LocalOutputInvocationError) throw cause;
        throw new LocalOutputInvocationError('The local Output Invocation failed.', { cause });
      }
    },
  });
}

interface ManagedInvocationProcess extends InvocationStreamProcess {
  readonly spawned: Promise<void>;
}

function manageProcess(
  child: ChildProcessWithoutNullStreams,
  maximumStderrBytes: number,
  graceMilliseconds: number,
  options?: ExtensionCallOptions
): ManagedInvocationProcess {
  let stderr = '';
  // A pipe error is also emitted by stdin itself. Keep a listener installed for
  // the lifetime of the stream so a late EPIPE can never escape as an
  // unhandled EventEmitter error. The active request write installs its own
  // listener to turn the same event into a rejected invocation.
  child.stdin.on('error', () => undefined);
  child.stderr.on('data', (chunk: Buffer) => {
    const remaining = maximumStderrBytes - Buffer.byteLength(stderr, 'utf8');
    if (remaining > 0) stderr += chunk.subarray(0, remaining).toString('utf8');
  });
  const spawned = new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    }
  );
  let terminationRequested = false;
  let stopPromise: Promise<void> | undefined;
  const abort = (): void => {
    if (terminationRequested) return;
    terminationRequested = true;
    terminate(child, graceMilliseconds);
  };
  options?.signal?.addEventListener('abort', abort, { once: true });

  async function result() {
    try {
      return await closed;
    } finally {
      options?.signal?.removeEventListener('abort', abort);
    }
  }

  return {
    spawned,
    requireSuccess: async () => {
      const status = await result();
      if (options?.signal?.aborted === true) throw abortError(options.signal);
      if (status.code !== 0) {
        throw new LocalOutputInvocationError(
          `The local Output Invoker exited unsuccessfully${stderr.length === 0 ? '.' : `: ${stderr}`}`
        );
      }
    },
    stop: () => {
      abort();
      stopPromise ??= result().then(
        () => undefined,
        () => undefined // Preserve the failure that caused process cleanup.
      );
      return stopPromise;
    },
  };
}

async function writeInvocationRequest(
  child: ChildProcessWithoutNullStreams,
  request: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      child.stdin.off('error', onError);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onError = (error: Error): void => settle(error);

    child.stdin.once('error', onError);
    child.stdin.end(request, 'utf8', () => settle());
  });
}

async function* readLines(
  child: ChildProcessWithoutNullStreams,
  maximumLineBytes: number
): AsyncGenerator<string> {
  const decoder = new BoundedLineDecoder(maximumLineBytes);
  for await (const chunk of child.stdout as AsyncIterable<Uint8Array>) {
    for (const line of decoder.push(Buffer.from(chunk))) {
      if (line.length > 0) yield line;
    }
  }
  for (const line of decoder.finish()) {
    if (line.length > 0) yield line;
  }
}

function terminate(child: ChildProcessWithoutNullStreams, graceMilliseconds: number): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timeout = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, graceMilliseconds);
  timeout.unref();
}

function positiveInteger(input: number, path: string): number {
  const value = nonNegativeInteger(input, path);
  if (value === 0) {
    throw new InvalidLocalCommandConfigurationError(`${path} must be greater than zero.`);
  }
  return value;
}

function nonNegativeInteger(input: number, path: string): number {
  if (!Number.isSafeInteger(input) || input < 0) {
    throw new InvalidLocalCommandConfigurationError(`${path} must be a non-negative integer.`);
  }
  return input;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  const error = new Error('Local Output Invocation was aborted.', { cause: signal.reason });
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
