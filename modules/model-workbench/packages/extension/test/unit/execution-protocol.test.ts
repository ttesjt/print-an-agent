import { describe, expect, it, vi } from 'vitest';

import { InvalidWorkbenchValueError, parseProfileId } from '@print-an-agent/workbench-domain';

import {
  CapabilityDispatchKind,
  defineExecutionSupport,
  ExecutionStatus,
  parseCapabilityDispatch,
} from '../../src/index.js';

describe('Execution Protocol', () => {
  it('normalizes immediate and detached dispatches through one closed system envelope', () => {
    expect(
      parseCapabilityDispatch(
        {
          kind: CapabilityDispatchKind.Completed,
          terminal: { status: ExecutionStatus.Succeeded, result: { value: 1 } },
        },
        (input) => input
      )
    ).toEqual({
      kind: CapabilityDispatchKind.Completed,
      terminal: { status: ExecutionStatus.Succeeded, result: { value: 1 } },
    });
    expect(
      parseCapabilityDispatch(
        {
          kind: CapabilityDispatchKind.Accepted,
          executionReceipt: { providerJobId: 'job:1' },
        },
        (input) => input
      )
    ).toEqual({
      kind: CapabilityDispatchKind.Accepted,
      executionReceipt: { providerJobId: 'job:1' },
    });
  });

  it('rejects contradictory dispatch and observation fields', async () => {
    expect(() =>
      parseCapabilityDispatch(
        {
          kind: CapabilityDispatchKind.Completed,
          terminal: { status: ExecutionStatus.Succeeded, result: null },
          executionReceipt: { jobId: 'job:1' },
        },
        (input) => input
      )
    ).toThrow(InvalidWorkbenchValueError);

    const support = defineExecutionSupport({
      runtimeSupportId: 'execution.fixture',
      observe: () =>
        Promise.resolve({
          status: ExecutionStatus.Running,
          progress: { step: 1 },
          result: null,
        }),
      cancel: vi.fn(),
    });
    await expect(
      support.observe({
        profileId: parseProfileId('profile:fixture'),
        executionReceipt: { jobId: 'job:1' },
      })
    ).rejects.toThrow(InvalidWorkbenchValueError);
  });

  it('keeps support behavior out of extension evidence while preserving identity', () => {
    const first = defineExecutionSupport({
      runtimeSupportId: 'execution.fixture',
      metadata: { provider: 'fixture' },
      observe: vi.fn(),
      cancel: vi.fn(),
    });
    const second = defineExecutionSupport({
      runtimeSupportId: 'execution.fixture',
      metadata: { provider: 'fixture' },
      observe: () => Promise.reject(new Error('different function identity')),
      cancel: () => Promise.resolve(),
    });

    expect(second.evidenceDigest).toBe(first.evidenceDigest);
  });
});
