import {
  createActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
} from '@print-an-agent/base-actor';
import { parseAgentId } from '@print-an-agent/base-identity';
import { RUN_WORKFLOW, skipWorkflow } from '@print-an-agent/workflow-core';
import { expect, it, vi } from 'vitest';
import {
  createSessionCompactionWorkflow,
  createShouldCompactSessionCondition,
  DEFAULT_SESSION_COMPACTION_POLICY,
  type SessionCompactionResources,
} from '../../src/index.js';
import { createSessionPortStub } from '../support/session-port-stub.js';

function boundaryResources(): SessionCompactionResources {
  return {
    session: createSessionPortStub(),
    responsibilities: createResponsibilityRouter({
      actorCatalog: createActorCatalog({ actors: [], engines: [] }),
      responsibilityCatalog: createResponsibilityCatalog({ responsibilities: [] }),
    }),
    instructions: 'Compact.',
    policy: DEFAULT_SESSION_COMPACTION_POLICY,
    clock: () => 1,
  };
}

const invalidInputs: readonly { label: string; create: (getter: () => never) => unknown }[] = [
  { label: 'null', create: () => null },
  { label: 'array', create: () => [] },
  { label: 'missing sessionId', create: () => ({}) },
  { label: 'non-string sessionId', create: () => ({ sessionId: 3 }) },
  { label: 'non-string branchId', create: () => ({ sessionId: 'session', branchId: false }) },
  { label: 'unknown field', create: () => ({ sessionId: 'session', unknown: true }) },
  { label: 'symbol field', create: () => ({ sessionId: 'session', [Symbol('unknown')]: true }) },
  {
    label: 'target getter',
    create: (getter) =>
      Object.defineProperty({ sessionId: 'session' }, 'target', { enumerable: true, get: getter }),
  },
  {
    label: 'sessionId getter',
    create: (getter) => Object.defineProperty({}, 'sessionId', { enumerable: true, get: getter }),
  },
  {
    label: 'nested target getter',
    create: (getter) => ({
      sessionId: 'session',
      target: Object.defineProperty({}, 'maxTokens', { enumerable: true, get: getter }),
    }),
  },
  { label: 'unknown target field', create: () => ({ sessionId: 'session', target: { extra: 1 } }) },
];

for (const mode of ['default', 'omitted', 'custom-run', 'custom-skip'] as const) {
  it.each(invalidInputs)(
    `rejects $label before ${mode} admission without I/O or getter execution`,
    async ({ create }) => {
      const getter = vi.fn((): never => {
        throw new Error('Input getter must not execute.');
      });
      const inspect = vi.fn(() => Promise.resolve(undefined));
      const entry = vi.fn(() => Promise.resolve());
      const condition = vi.fn(
        mode === 'default'
          ? createShouldCompactSessionCondition()
          : () => (mode === 'custom-skip' ? skipWorkflow('host-skip') : RUN_WORKFLOW)
      );
      const workflow = createSessionCompactionWorkflow({
        resources: { ...boundaryResources(), session: createSessionPortStub({ inspect }) },
        ...(mode === 'omitted' ? {} : { condition }),
        stepOverrides: { runSessionCompaction: entry },
      });
      const events: string[] = [];
      await expect(
        workflow.run({
          input: {
            agentId: parseAgentId('input-boundary'),
            // @ts-expect-error Exercise unknown JavaScript business input at the public entry.
            compactionInput: create(getter),
          },
          onEvent: (event) => {
            events.push(event.type);
          },
        })
      ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_INVALID' });
      expect(getter).not.toHaveBeenCalled();
      expect(condition).not.toHaveBeenCalled();
      expect(inspect).not.toHaveBeenCalled();
      expect(entry).not.toHaveBeenCalled();
      expect(events).toEqual(['workflow-started', 'workflow-failed']);
    }
  );
}

it('revalidates caller input changed during an async condition without executing a newly added getter', async () => {
  const original = { sessionId: 'session', target: { maxTokens: 20 } };
  const getter = vi.fn(() => ({ maxTokens: 20 }));
  const entry = vi.fn(() => Promise.resolve());
  const workflow = createSessionCompactionWorkflow({
    resources: boundaryResources(),
    condition: async ({ input }) => {
      expect(input.compactionInput).not.toBe(original);
      expect(Object.isFrozen(input.compactionInput)).toBe(true);
      expect(Object.isFrozen(input.compactionInput.target)).toBe(true);
      await Promise.resolve();
      Object.defineProperty(original, 'target', { enumerable: true, get: getter });
      return RUN_WORKFLOW;
    },
    stepOverrides: { runSessionCompaction: entry },
  });
  await expect(
    workflow.run({
      input: {
        agentId: parseAgentId('input-boundary'),
        compactionInput: original,
      },
    })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_INVALID' });
  expect(getter).not.toHaveBeenCalled();
  expect(entry).not.toHaveBeenCalled();
});
