import { expect, it } from 'vitest';
import { createAgentActorCatalog, MAIN_ACTOR_ID } from '../../../src/index.js';
import { fakeEngine, type FakeEngineInspection } from '../../support/fixtures.js';
import { expectActorError } from '../../support/actor-errors.js';
function inspection(): FakeEngineInspection {
  return { interactionRequests: [], directRequests: [] };
}
it('rejects duplicate catalog identity and missing Engine bindings', () => {
  const engine = fakeEngine('engine', inspection());
  expectActorError(
    () =>
      createAgentActorCatalog({
        actors: [
          { id: 'main', engineId: 'engine' },
          { id: 'main', engineId: 'engine' },
        ],
        engines: [engine],
      }),
    'ACTOR_CATALOG_INVALID'
  );
  expectActorError(
    () =>
      createAgentActorCatalog({
        actors: [{ id: 'main', engineId: 'missing' }],
        engines: [engine],
      }),
    'ACTOR_ENGINE_NOT_FOUND'
  );
});

it('returns immutable detached definitions and resolved revisions', async () => {
  const catalog = createAgentActorCatalog({
    revision: 7,
    actors: [
      {
        id: 'main',
        engineId: 'engine',
        invocationPolicy: { timeoutMilliseconds: 1000 },
        allowedTools: ['search'],
      },
    ],
    engines: [fakeEngine('engine', inspection())],
  });
  const listed = catalog.list();
  const actor = await catalog.resolve(MAIN_ACTOR_ID);
  expect(actor.catalogRevision).toBe(7);
  expect(Object.isFrozen(listed)).toBe(true);
  expect(Object.isFrozen(listed[0]?.allowedTools)).toBe(true);
  expect(listed[0]?.invocationPolicy).toEqual({ timeoutMilliseconds: 1000 });
  expect(Object.isFrozen(listed[0]?.invocationPolicy)).toBe(true);
  expect(Object.isFrozen(actor.capabilities)).toBe(true);
});
