import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OutputInvocationKind, type ModelWorkbench } from '@ta-agent/workbench-application';
import { describe, expect, it, vi } from 'vitest';

import {
  ModelWorkbenchCliCommandKind,
  parseModelWorkbenchCliCommand,
  readModelWorkbenchCliJsonDocument,
  runModelWorkbenchCli,
  type ModelWorkbenchCliWriter,
} from '../../src/index.js';

describe('Model Workbench CLI', () => {
  it('parses one thin public API command', () => {
    expect(
      parseModelWorkbenchCliCommand([
        'run',
        'list',
        '--application',
        './workbench.mjs',
        '--request',
        './request.json',
      ])
    ).toEqual({
      kind: ModelWorkbenchCliCommandKind.RunList,
      applicationPath: './workbench.mjs',
      requestPath: './request.json',
    });
  });

  it('writes streaming Output Invocation chunks without creating a Run', async () => {
    const output: string[] = [];
    const close = vi.fn(() => Promise.resolve());
    const invoke = vi.fn(() =>
      Promise.resolve({
        kind: OutputInvocationKind.Streaming,
        stream: stream(['one', { text: 'two' }]),
      })
    );
    const workbench = { outputInvocations: { invoke } } as unknown as ModelWorkbench;

    const exitCode = await runModelWorkbenchCli(
      ['output', 'invoke', '--application', './workbench.mjs', '--request', './request.json'],
      {
        loadApplication: () => Promise.resolve({ workbench, close }),
        readJsonDocument: () =>
          Promise.resolve({
            profileId: 'profile:test',
            outputId: 'output:test',
            outputInvokerId: 'generate',
            input: { prompt: 'hello' },
          }),
        standardOutput: writer(output),
        standardError: writer([]),
        signal: new AbortController().signal,
      }
    );

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      '{"kind":"chunk","result":"one"}\n',
      '{"kind":"chunk","result":{"text":"two"}}\n',
    ]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('reads a bounded regular JSON request through one stable file descriptor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-cli-'));
    const documentPath = join(directory, 'request.json');
    try {
      await writeFile(documentPath, '{"profileId":"profile:test"}', 'utf8');
      await expect(readModelWorkbenchCliJsonDocument(documentPath)).resolves.toEqual({
        profileId: 'profile:test',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects symlinked JSON request files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-cli-'));
    const targetPath = join(directory, 'target.json');
    const linkPath = join(directory, 'request.json');
    try {
      await writeFile(targetPath, '{}', 'utf8');
      await symlink(targetPath, linkPath);
      await expect(readModelWorkbenchCliJsonDocument(linkPath)).rejects.toMatchObject({
        code: 'CLI_REQUEST_INVALID',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects JSON request files larger than 4 MiB', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-cli-'));
    const documentPath = join(directory, 'request.json');
    try {
      await writeFile(documentPath, `"${'x'.repeat(4 * 1_048_576)}"`, 'utf8');
      await expect(readModelWorkbenchCliJsonDocument(documentPath)).rejects.toMatchObject({
        code: 'CLI_REQUEST_INVALID',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function writer(output: string[]): ModelWorkbenchCliWriter {
  return Object.freeze({
    write: (text: string) => {
      output.push(text);
      return Promise.resolve();
    },
  });
}

async function* stream(values: readonly unknown[]) {
  for (const value of values) yield await Promise.resolve(value);
}
