import { expect, it } from 'vitest';
import { defineAgentActor } from '../../../src/index.js';
import { expectActorError } from '../../support/actor-errors.js';
it('keeps optional Actor extensions empty and Tool permission denied by omission', () => {
  expect(defineAgentActor({ id: 'minimal', engineId: 'engine' })).toEqual({
    id: 'minimal',
    engineId: 'engine',
    invocationConfig: {},
    invocationPolicy: { timeoutMilliseconds: null },
    allowedTools: [],
  });
});

it('rejects unknown invocation config and normalizes Actor-owned Tool errors', () => {
  expectActorError(
    () =>
      defineAgentActor({
        id: 'invalid-config',
        engineId: 'engine',
        invocationConfig: { temperature: 0.2, seed: 1 } as never,
      }),
    'ACTOR_DEFINITION_INVALID'
  );
  expectActorError(
    () =>
      defineAgentActor({
        id: 'invalid-tool',
        engineId: 'engine',
        allowedTools: ['bad tool'],
      }),
    'ACTOR_DEFINITION_INVALID'
  );
});
