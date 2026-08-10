import { describe, expect, it, vi } from 'vitest';
import { parseAgentBaseCliCommand, runAgentBaseCli } from '../../src/index.js';
import type {
  AgentBaseCliDependencies,
  AgentBaseCliRuntime,
  AgentBaseCliWriter,
} from '../../src/index.js';

function writer(): AgentBaseCliWriter & { output(): string } {
  let output = '';
  return {
    write: (text) => {
      output += text;
      return Promise.resolve();
    },
    output: () => output,
  };
}

function runtime(overrides: Partial<AgentBaseCliRuntime> = {}): AgentBaseCliRuntime {
  return {
    checkProvider: () => Promise.resolve({ status: 'ready' }),
    run: (_input, options) => options.writeTextDelta('mock response'),
    compactSession: () => Promise.resolve({ status: 'skipped' }),
    inspectSession: () => Promise.resolve({ status: 'inspected' }),
    selectSessionBranch: () => Promise.resolve({ status: 'selected' }),
    forkSessionBranch: () => Promise.resolve({ status: 'forked' }),
    rewindSession: () => Promise.resolve({ status: 'rewound' }),
    ...overrides,
  };
}

function dependencies(
  testRuntime: AgentBaseCliRuntime,
  standardInput = 'stdin message'
): AgentBaseCliDependencies & {
  standardOutput: AgentBaseCliWriter & { output(): string };
  standardError: AgentBaseCliWriter & { output(): string };
} {
  return {
    loadRuntime: () => Promise.resolve(testRuntime),
    loadManagedDirectory: () =>
      Promise.resolve({
        create: () => Promise.resolve({ status: 'created' }),
        list: () => Promise.resolve([]),
        inspect: () => Promise.resolve({ status: 'active' }),
        disable: () => Promise.resolve({ status: 'disabled' }),
        reactivate: () => Promise.resolve({ status: 'active' }),
      }),
    readJsonDocument: () => Promise.resolve({ schemaVersion: 1 }),
    readStandardInput: () => Promise.resolve(standardInput),
    standardOutput: writer(),
    standardError: writer(),
    signal: new AbortController().signal,
  };
}

describe('Agent Base CLI command contract', () => {
  it('parses a bounded run command without provider-specific options', () => {
    expect(
      parseAgentBaseCliCommand([
        'run',
        '--config',
        'agent.json',
        '--message',
        'hello',
        '--session-id',
        'session-1',
        '--idempotency-key',
        'request-1',
      ])
    ).toEqual({
      kind: 'run',
      runtime: { kind: 'config', configPath: 'agent.json' },
      messageSource: { kind: 'argument', value: 'hello' },
      sessionId: 'session-1',
      idempotencyKey: 'request-1',
    });
  });

  it('parses managed runtime and Agent lifecycle commands without conflating their scopes', () => {
    expect(
      parseAgentBaseCliCommand(['provider', 'check', '--root', '/agents', '--agent-id', 'bro'])
    ).toEqual({
      kind: 'provider-check',
      runtime: { kind: 'managed', rootDirectory: '/agents', agentId: 'bro' },
    });
    expect(
      parseAgentBaseCliCommand([
        'agent',
        'disable',
        '--root',
        '/agents',
        '--agent-id',
        'bro',
        '--expected-revision',
        '2',
      ])
    ).toEqual({
      kind: 'agent-disable',
      rootDirectory: '/agents',
      agentId: 'bro',
      expectedRevision: 2,
    });
    expect(() =>
      parseAgentBaseCliCommand([
        'run',
        '--config',
        'agent.json',
        '--root',
        '/agents',
        '--agent-id',
        'bro',
        '--message',
        'hello',
      ])
    ).toThrow('cannot be combined');
  });

  it('routes lifecycle commands through the managed directory and emits safe JSON', async () => {
    const baseDependencies = dependencies(runtime());
    const disable = vi.fn(() =>
      Promise.resolve({ agentId: 'bro', status: 'disabled', identityRevision: 2 })
    );
    const deps = {
      ...baseDependencies,
      loadManagedDirectory: () =>
        Promise.resolve({
          create: () => Promise.resolve({}),
          list: () => Promise.resolve([]),
          inspect: () => Promise.resolve({}),
          disable,
          reactivate: () => Promise.resolve({}),
        }),
    };

    await expect(
      runAgentBaseCli(
        ['agent', 'disable', '--root', '/agents', '--agent-id', 'bro', '--expected-revision', '1'],
        deps
      )
    ).resolves.toBe(0);
    expect(disable).toHaveBeenCalledWith('bro', 1);
    expect(JSON.parse(deps.standardOutput.output()) as unknown).toEqual({
      agentId: 'bro',
      status: 'disabled',
      identityRevision: 2,
    });
  });

  it('rejects ambiguous message input and unknown options', () => {
    expect(() =>
      parseAgentBaseCliCommand([
        'run',
        '--config',
        'agent.json',
        '--message',
        'hello',
        '--message-stdin',
      ])
    ).toThrow('Exactly one');
    expect(() =>
      parseAgentBaseCliCommand([
        'provider',
        'check',
        '--config',
        'agent.json',
        '--api-key',
        'secret',
      ])
    ).toThrow('not supported');
  });

  it('streams request output and terminates successful output with one newline', async () => {
    const run = vi.fn<AgentBaseCliRuntime['run']>(async (_input, options) => {
      await options.writeTextDelta('first ');
      await options.writeTextDelta('second');
      return { requestId: 'request-1' };
    });
    const deps = dependencies(runtime({ run }));

    await expect(
      runAgentBaseCli(
        ['run', '--config', 'agent.json', '--message-stdin', '--session-id', 'session-1'],
        deps
      )
    ).resolves.toBe(0);
    expect(deps.standardOutput.output()).toBe('first second\n');
    expect(deps.standardError.output()).toBe('');
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toEqual({
      message: 'stdin message',
      sessionId: 'session-1',
    });
    expect(run.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('returns readiness metadata and the credential-unavailable exit contract', async () => {
    const deps = dependencies(
      runtime({
        checkProvider: () =>
          Promise.resolve({ status: 'credential-unavailable', provider: 'test' }),
      })
    );

    await expect(
      runAgentBaseCli(['provider', 'check', '--config', 'agent.json'], deps)
    ).resolves.toBe(3);
    expect(JSON.parse(deps.standardOutput.output()) as unknown).toEqual({
      status: 'credential-unavailable',
      provider: 'test',
    });
    expect(deps.standardError.output()).toBe('');
  });

  it('routes every Session command to one matching Application API operation', async () => {
    const compactSession = vi.fn<AgentBaseCliRuntime['compactSession']>(() =>
      Promise.resolve({ status: 'compacted' })
    );
    const inspectSession = vi.fn<AgentBaseCliRuntime['inspectSession']>(() =>
      Promise.resolve({ status: 'inspected' })
    );
    const selectSessionBranch = vi.fn<AgentBaseCliRuntime['selectSessionBranch']>(() =>
      Promise.resolve({ status: 'selected' })
    );
    const forkSessionBranch = vi.fn<AgentBaseCliRuntime['forkSessionBranch']>(() =>
      Promise.resolve({ status: 'forked' })
    );
    const rewindSession = vi.fn<AgentBaseCliRuntime['rewindSession']>(() =>
      Promise.resolve({ status: 'rewound' })
    );
    const deps = dependencies(
      runtime({
        compactSession,
        inspectSession,
        selectSessionBranch,
        forkSessionBranch,
        rewindSession,
      })
    );

    await runAgentBaseCli(
      [
        'session',
        'compact',
        '--config',
        'agent.json',
        '--session-id',
        'session-1',
        '--branch-id',
        'branch-1',
      ],
      deps
    );
    await runAgentBaseCli(
      ['session', 'inspect', '--config', 'agent.json', '--session-id', 'session-1'],
      deps
    );
    await runAgentBaseCli(
      [
        'session',
        'select',
        '--config',
        'agent.json',
        '--session-id',
        'session-1',
        '--branch-id',
        'branch-2',
        '--expected-revision',
        '3',
      ],
      deps
    );
    await runAgentBaseCli(
      [
        'session',
        'fork',
        '--config',
        'agent.json',
        '--session-id',
        'session-1',
        '--source-branch-id',
        'branch-1',
        '--through-turn-id',
        'turn-1',
        '--new-branch-id',
        'branch-3',
        '--expected-revision',
        '4',
      ],
      deps
    );
    await runAgentBaseCli(
      [
        'session',
        'rewind',
        '--config',
        'agent.json',
        '--session-id',
        'session-1',
        '--through-turn-id',
        'turn-2',
        '--expected-revision',
        '5',
      ],
      deps
    );

    expect(compactSession.mock.calls[0]?.[0]).toEqual({
      sessionId: 'session-1',
      branchId: 'branch-1',
    });
    expect(inspectSession.mock.calls[0]?.[0]).toBe('session-1');
    expect(selectSessionBranch.mock.calls[0]?.[0]).toEqual({
      sessionId: 'session-1',
      branchId: 'branch-2',
      expectedRevision: 3,
    });
    expect(forkSessionBranch.mock.calls[0]?.[0]).toEqual({
      sessionId: 'session-1',
      sourceBranchId: 'branch-1',
      throughTurnId: 'turn-1',
      newBranchId: 'branch-3',
      expectedRevision: 4,
    });
    expect(rewindSession.mock.calls[0]?.[0]).toEqual({
      sessionId: 'session-1',
      throughTurnId: 'turn-2',
      expectedRevision: 5,
    });
  });

  it('emits only a stable runtime code when a command fails', async () => {
    const deps = dependencies(
      runtime({
        compactSession: () =>
          Promise.reject(
            Object.assign(new Error('PRIVATE prompt and provider response'), {
              code: 'SESSION_REVISION_CONFLICT',
            })
          ),
      })
    );

    await expect(
      runAgentBaseCli(
        ['session', 'compact', '--config', 'agent.json', '--session-id', 'session-1'],
        deps
      )
    ).resolves.toBe(1);
    expect(deps.standardError.output()).toBe(
      'Agent Base command failed (SESSION_REVISION_CONFLICT).\n'
    );
    expect(deps.standardError.output()).not.toContain('PRIVATE');
  });
});
