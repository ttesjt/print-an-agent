import { constants as fileConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ModelWorkbench } from '@print-an-agent/workbench-application';

import type { LoadedModelWorkbenchApplication } from './contracts.js';
import { ModelWorkbenchCliError } from './errors.js';

const MAXIMUM_REQUEST_BYTES = 4 * 1_048_576;

export async function loadModelWorkbenchCliApplication(
  modulePath: string
): Promise<LoadedModelWorkbenchApplication> {
  try {
    const loaded: unknown = await import(pathToFileURL(resolve(modulePath)).href);
    if (!isRecord(loaded) || !isAsyncFactory(loaded.createWorkbench)) {
      throw new ModelWorkbenchCliError(
        'CLI_APPLICATION_INVALID',
        'Application module must export createWorkbench().'
      );
    }
    const workbench: unknown = await loaded.createWorkbench();
    if (!isModelWorkbench(workbench)) {
      throw new ModelWorkbenchCliError(
        'CLI_APPLICATION_INVALID',
        'createWorkbench() did not return a Model Workbench.'
      );
    }
    const close = loaded.close;
    if (close !== undefined && !isAsyncCloser(close)) {
      throw new ModelWorkbenchCliError(
        'CLI_APPLICATION_INVALID',
        'Application close export must be a function.'
      );
    }
    return Object.freeze({
      workbench,
      close: async () => {
        if (isAsyncCloser(close)) await close();
      },
    });
  } catch (cause: unknown) {
    if (cause instanceof ModelWorkbenchCliError) throw cause;
    throw new ModelWorkbenchCliError(
      'CLI_APPLICATION_INVALID',
      'Application module could not be loaded.',
      { cause }
    );
  }
}

export async function readModelWorkbenchCliJsonDocument(path: string): Promise<unknown> {
  const absolutePath = resolve(path);
  try {
    const bytes = await readBoundedRegularFile(absolutePath, MAXIMUM_REQUEST_BYTES);
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (cause: unknown) {
    if (cause instanceof ModelWorkbenchCliError) throw cause;
    throw new ModelWorkbenchCliError('CLI_REQUEST_INVALID', 'Request JSON could not be loaded.', {
      cause,
    });
  }
}

async function readBoundedRegularFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(
    path,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW | fileConstants.O_NONBLOCK
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) invalidRequestFile();

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remaining = maximumBytes + 1 - totalBytes;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maximumBytes) invalidRequestFile();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
}

function invalidRequestFile(): never {
  throw new ModelWorkbenchCliError(
    'CLI_REQUEST_INVALID',
    'Request must be a regular JSON file no larger than 4 MiB.'
  );
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isAsyncFactory(input: unknown): input is () => unknown {
  return typeof input === 'function';
}

function isAsyncCloser(input: unknown): input is () => unknown {
  return typeof input === 'function';
}

function isModelWorkbench(input: unknown): input is ModelWorkbench {
  if (!isRecord(input)) return false;
  return [
    'initialization',
    'training',
    'exports',
    'outputInvocations',
    'runs',
    'models',
    'outputs',
  ].every((key) => isRecord(input[key]));
}
