import { describe, expect, it, vi } from 'vitest';
import { parseAgentBaseCliCommand, runAgentBaseCli } from '../../src/index.js';
import type {
  AgentBaseCliDependencies,
  AgentBaseCliRuntime,
  AgentBaseCliSessionManager,
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
    run: (_input, options) => options.writeTextDelta('mock response'),
    compactSession: () => Promise.resolve({ status: 'skipped' }),
    inspectSession: () => Promise.resolve({ status: 'inspected' }),
    selectSessionBranch: () => Promise.resolve({ status: 'selected' }),
    forkSessionBranch: () => Promise.resolve({ status: 'forked' }),
    rewindSession: () => Promise.resolve({ status: 'rewound' }),
    ...overrides,
  };
}

function sessionManager(
  overrides: Partial<AgentBaseCliSessionManager> = {}
): AgentBaseCliSessionManager {
  return {
    list: () => Promise.resolve({ records: [] }),
    listRetired: () => Promise.resolve({ records: [] }),
    inspect: () => Promise.resolve(undefined),
    listTurns: () => Promise.resolve(undefined),
    retire: () => Promise.resolve({ status: 'retired' }),
    restore: () => Promise.resolve({ status: 'active' }),
    purge: () => Promise.resolve(),
    recover: () => Promise.resolve({ state: 'ready' }),
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
    loadProvider: () => Promise.resolve({ check: () => Promise.resolve({ status: 'ready' }) }),
    loadRuntime: () => Promise.resolve(testRuntime),
    loadManagedDirectory: () =>
      Promise.resolve({
        create: () => Promise.resolve({ status: 'created' }),
        list: () => Promise.resolve([]),
        inspect: () => Promise.resolve({ status: 'active' }),
        disable: () => Promise.resolve({ status: 'disabled' }),
        reactivate: () => Promise.resolve({ status: 'active' }),
      }),
    loadSessionManager: () => Promise.resolve(sessionManager()),
    readJsonDocument: () => Promise.resolve({ schemaVersion: 1 }),
    readStandardInput: () => Promise.resolve(standardInput),
    standardOutput: writer(),
    standardError: writer(),
    signal: new AbortController().signal,
  };
}

describe('Agent Base CLI command contract', () => {
  it('reports a generated Session ID separately from assistant text', async () => {
    const deps = dependencies(
      runtime({
        run: async (_input, options) => {
          await options.sessionOpened('generated-session');
          await options.writeTextDelta('answer');
        },
      })
    );
    expect(
      await runAgentBaseCli(['run', '--config', 'agent.json', '--message', 'hello'], deps)
    ).toBe(0);
    expect(deps.standardOutput.output()).toBe('answer\n');
    expect(deps.standardError.output()).toBe(
      '{"type":"session-created","sessionId":"generated-session"}\n'
    );
  });
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
    const baseDependencies = dependencies(runtime());
    const loadRuntime = vi.fn(baseDependencies.loadRuntime);
    const loadProvider = vi.fn(() =>
      Promise.resolve({
        check: () => Promise.resolve({ status: 'credential-unavailable', provider: 'test' }),
      })
    );
    const deps = { ...baseDependencies, loadProvider, loadRuntime };

    await expect(
      runAgentBaseCli(['provider', 'check', '--config', 'agent.json'], deps)
    ).resolves.toBe(3);
    expect(JSON.parse(deps.standardOutput.output()) as unknown).toEqual({
      status: 'credential-unavailable',
      provider: 'test',
    });
    expect(deps.standardError.output()).toBe('');
    expect(loadProvider).toHaveBeenCalledOnce();
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it('does not load provider inspection for runtime commands', async () => {
    const baseDependencies = dependencies(runtime());
    const loadProvider = vi.fn(baseDependencies.loadProvider);
    const deps = { ...baseDependencies, loadProvider };

    await expect(
      runAgentBaseCli(['run', '--config', 'agent.json', '--message', 'hello'], deps)
    ).resolves.toBe(0);
    expect(loadProvider).not.toHaveBeenCalled();
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

  it('parses managed-only Session lifecycle commands and strict destructive confirmation', () => {
    expect(
      parseAgentBaseCliCommand([
        'session',
        'lifecycle',
        'list',
        '--root',
        '/agents',
        '--agent-id',
        'bro',
        '--limit',
        '20',
        '--cursor-updated-at',
        '100',
        '--cursor-session-id',
        'session-1',
      ])
    ).toEqual({
      kind: 'session-lifecycle-list',
      rootDirectory: '/agents',
      agentId: 'bro',
      limit: 20,
      cursor: { updatedAt: 100, sessionId: 'session-1' },
    });
    expect(
      parseAgentBaseCliCommand([
        'session',
        'lifecycle',
        'purge',
        '--root',
        '/agents',
        '--agent-id',
        'bro',
        '--session-id',
        'session-1',
        '--expected-revision',
        '2',
        '--confirm-permanent-delete',
      ])
    ).toEqual({
      kind: 'session-lifecycle-purge',
      rootDirectory: '/agents',
      agentId: 'bro',
      sessionId: 'session-1',
      expectedRevision: 2,
    });
    expect(() =>
      parseAgentBaseCliCommand(['session', 'lifecycle', 'list', '--config', 'agent.json'])
    ).toThrow('not supported');
    expect(() =>
      parseAgentBaseCliCommand([
        'session',
        'lifecycle',
        'list',
        '--root',
        '/agents',
        '--agent-id',
        'bro',
        '--cursor-updated-at',
        '100',
      ])
    ).toThrow('must be provided together');
    expect(() =>
      parseAgentBaseCliCommand([
        'session',
        'lifecycle',
        'purge',
        '--root',
        '/agents',
        '--agent-id',
        'bro',
        '--session-id',
        'session-1',
        '--expected-revision',
        '2',
      ])
    ).toThrow('--confirm-permanent-delete is required');
  });

  it('routes every Session lifecycle command through only the Session manager', async () => {
    const list = vi.fn<AgentBaseCliSessionManager['list']>(() =>
      Promise.resolve({ records: ['active'] })
    );
    const listRetired = vi.fn<AgentBaseCliSessionManager['listRetired']>(() =>
      Promise.resolve({ records: ['retired'] })
    );
    const inspect = vi.fn<AgentBaseCliSessionManager['inspect']>(() =>
      Promise.resolve({ status: 'active' })
    );
    const listTurns = vi.fn<AgentBaseCliSessionManager['listTurns']>(() =>
      Promise.resolve({ records: ['turn'] })
    );
    const retire = vi.fn<AgentBaseCliSessionManager['retire']>(() =>
      Promise.resolve({ status: 'retired' })
    );
    const restore = vi.fn<AgentBaseCliSessionManager['restore']>(() =>
      Promise.resolve({ status: 'active' })
    );
    const purge = vi.fn<AgentBaseCliSessionManager['purge']>(() => Promise.resolve());
    const recover = vi.fn<AgentBaseCliSessionManager['recover']>(() =>
      Promise.resolve({ state: 'ready' })
    );
    const manager = sessionManager({
      list,
      listRetired,
      inspect,
      listTurns,
      retire,
      restore,
      purge,
      recover,
    });
    const baseDependencies = dependencies(runtime());
    const loadSessionManager = vi.fn(() => Promise.resolve(manager));
    const loadRuntime = vi.fn(baseDependencies.loadRuntime);
    const loadProvider = vi.fn(baseDependencies.loadProvider);
    const loadManagedDirectory = vi.fn(baseDependencies.loadManagedDirectory);
    const deps = {
      ...baseDependencies,
      loadSessionManager,
      loadRuntime,
      loadProvider,
      loadManagedDirectory,
    };
    const scope = ['--root', '/agents', '--agent-id', 'bro'] as const;

    await runAgentBaseCli(['session', 'lifecycle', 'list', ...scope, '--limit', '10'], deps);
    await runAgentBaseCli(['session', 'lifecycle', 'list-retired', ...scope], deps);
    await runAgentBaseCli(
      ['session', 'lifecycle', 'inspect', ...scope, '--session-id', 'session-1'],
      deps
    );
    await runAgentBaseCli(
      [
        'session',
        'lifecycle',
        'turns',
        ...scope,
        '--session-id',
        'session-1',
        '--before-turn-id',
        'turn-1',
      ],
      deps
    );
    await runAgentBaseCli(
      [
        'session',
        'lifecycle',
        'retire',
        ...scope,
        '--session-id',
        'session-1',
        '--expected-revision',
        '1',
      ],
      deps
    );
    await runAgentBaseCli(
      [
        'session',
        'lifecycle',
        'restore',
        ...scope,
        '--session-id',
        'session-1',
        '--expected-revision',
        '2',
      ],
      deps
    );
    await runAgentBaseCli(
      [
        'session',
        'lifecycle',
        'recover',
        ...scope,
        '--session-id',
        'session-1',
        '--expected-execution-revision',
        '3',
      ],
      deps
    );
    await runAgentBaseCli(
      [
        'session',
        'lifecycle',
        'purge',
        ...scope,
        '--session-id',
        'session-1',
        '--expected-revision',
        '4',
        '--confirm-permanent-delete',
      ],
      deps
    );

    expect(loadSessionManager).toHaveBeenCalledTimes(8);
    expect(loadSessionManager).toHaveBeenCalledWith('/agents', 'bro');
    expect(list).toHaveBeenCalledWith({ limit: 10 });
    expect(listRetired).toHaveBeenCalledWith({});
    expect(inspect).toHaveBeenCalledWith('session-1');
    expect(listTurns).toHaveBeenCalledWith({ sessionId: 'session-1', beforeTurnId: 'turn-1' });
    expect(retire).toHaveBeenCalledWith('session-1', 1);
    expect(restore).toHaveBeenCalledWith('session-1', 2);
    expect(recover).toHaveBeenCalledWith('session-1', 3);
    expect(purge).toHaveBeenCalledWith('session-1', 4);
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(loadProvider).not.toHaveBeenCalled();
    expect(loadManagedDirectory).not.toHaveBeenCalled();
    expect(deps.standardOutput.output()).toContain(
      '{"status":"purged","agentId":"bro","sessionId":"session-1"}'
    );
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
