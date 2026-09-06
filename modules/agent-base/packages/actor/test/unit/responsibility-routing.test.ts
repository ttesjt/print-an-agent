import { describe, expect, it } from 'vitest';
import {
  createActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
  MAIN_ACTOR_ID,
  parseResponsibilityId,
} from '../../src/index.js';
import { EMPTY_TOOL_RUNTIME, fakeEngine, type FakeEngineInspection } from '../support/fixtures.js';

function inspection(): FakeEngineInspection {
  return { interactionRequests: [], directRequests: [] };
}

function expectResponsibilityError(action: () => unknown, code: string): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toEqual(expect.objectContaining({ code }));
}

function interactionRequest(instructions = 'Step instructions') {
  return {
    instructions,
    history: Object.freeze([]),
    prompt: Object.freeze({ role: 'user' as const, text: 'hello', timestamp: 1 }),
    tools: EMPTY_TOOL_RUNTIME,
    maxModelTurns: 2,
    maxOutputCharacters: 100,
    signal: new AbortController().signal,
    emit: () => Promise.resolve(),
  };
}

describe('Responsibility routing', () => {
  it('defaults an unconfigured registered Responsibility to main', async () => {
    const calls = inspection();
    const actors = createActorCatalog({
      actors: [{ id: 'main', engineId: 'main-engine' }],
      engines: [fakeEngine('main-engine', calls)],
    });
    const responsibilities = createResponsibilityCatalog({
      responsibilities: [
        {
          id: FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
          requiredCapabilities: { invocationMode: 'interaction' },
        },
      ],
    });
    const resolved = await createResponsibilityRouter({
      actorCatalog: actors,
      responsibilityCatalog: responsibilities,
    }).resolve(FOREGROUND_INTERACTION_RESPONSIBILITY_ID);
    expect(resolved.actor.id).toBe(MAIN_ACTOR_ID);
    expect(resolved.effectiveCandidates).toEqual([{ actorId: MAIN_ACTOR_ID, enabled: true }]);
  });

  it('treats explicit empty and all-disabled lists as unavailable without hidden fallback', async () => {
    const actors = createActorCatalog({
      actors: [{ id: 'main', engineId: 'engine' }],
      engines: [fakeEngine('engine', inspection())],
    });
    for (const actorCandidates of [[], [{ actorId: 'main', enabled: false }]]) {
      const responsibilities = createResponsibilityCatalog({
        responsibilities: [
          {
            id: 'disabled',
            actors: actorCandidates,
            requiredCapabilities: { invocationMode: 'direct' },
          },
        ],
      });
      await expect(
        createResponsibilityRouter({
          actorCatalog: actors,
          responsibilityCatalog: responsibilities,
        }).resolve(parseResponsibilityId('disabled'))
      ).rejects.toMatchObject({ code: 'RESPONSIBILITY_UNAVAILABLE' });
    }
  });

  it('selects the first enabled compatible Actor in configured order', async () => {
    const actors = createActorCatalog({
      actors: [
        { id: 'main', engineId: 'main-engine' },
        { id: 'disabled', engineId: 'disabled-engine' },
        {
          id: 'direct-only',
          engineId: 'main-engine',
          capabilityLimits: { invocationModes: ['direct'] },
        },
        {
          id: 'not-streamable',
          engineId: 'main-engine',
          capabilityLimits: { interaction: { streamable: false } },
        },
        { id: 'selected', engineId: 'selected-engine' },
      ],
      engines: [
        fakeEngine('main-engine', inspection()),
        fakeEngine('disabled-engine', inspection()),
        fakeEngine('selected-engine', inspection()),
      ],
    });
    const responsibilities = createResponsibilityCatalog({
      revision: 4,
      responsibilities: [
        {
          id: 'ordered',
          actors: [
            { actorId: 'disabled', enabled: false },
            { actorId: 'direct-only', enabled: true },
            { actorId: 'not-streamable', enabled: true },
            { actorId: 'selected', enabled: true },
          ],
          requiredCapabilities: {
            invocationMode: 'interaction',
            interaction: { streamable: true },
          },
        },
      ],
    });
    const resolved = await createResponsibilityRouter({
      actorCatalog: actors,
      responsibilityCatalog: responsibilities,
    }).resolve(parseResponsibilityId('ordered'));
    expect(resolved.actor.id).toBe('selected');
    expect(resolved.candidateIndex).toBe(3);
    expect(resolved.catalogRevision).toBe(4);
  });

  it('rejects interaction streamability requirements on direct invocation', () => {
    expectResponsibilityError(
      () =>
        createResponsibilityCatalog({
          responsibilities: [
            {
              id: 'invalid-direct-streamability',
              requiredCapabilities: {
                invocationMode: 'direct',
                interaction: { streamable: true },
              },
            },
          ],
        }),
      'RESPONSIBILITY_DEFINITION_INVALID'
    );
  });

  it('fails unknown Responsibilities and missing enabled Actors', async () => {
    const actors = createActorCatalog({
      actors: [{ id: 'main', engineId: 'engine' }],
      engines: [fakeEngine('engine', inspection())],
    });
    const missing = createResponsibilityCatalog({
      responsibilities: [
        {
          id: 'missing-actor',
          actors: [{ actorId: 'missing', enabled: true }],
          requiredCapabilities: { invocationMode: 'direct' },
        },
      ],
    });
    const router = createResponsibilityRouter({
      actorCatalog: actors,
      responsibilityCatalog: missing,
    });
    await expect(router.resolve(parseResponsibilityId('missing-actor'))).rejects.toMatchObject({
      code: 'ACTOR_NOT_FOUND',
    });
    await expect(router.resolve(parseResponsibilityId('unknown'))).rejects.toMatchObject({
      code: 'RESPONSIBILITY_NOT_FOUND',
    });
  });

  it('rejects duplicate Responsibility and candidate identities', () => {
    expectResponsibilityError(
      () =>
        createResponsibilityCatalog({
          responsibilities: [
            { id: 'duplicate', requiredCapabilities: { invocationMode: 'direct' } },
            { id: 'duplicate', requiredCapabilities: { invocationMode: 'direct' } },
          ],
        }),
      'RESPONSIBILITY_CATALOG_INVALID'
    );
    expectResponsibilityError(
      () =>
        createResponsibilityCatalog({
          responsibilities: [
            {
              id: 'duplicate-candidate',
              actors: [
                { actorId: 'main', enabled: true },
                { actorId: 'main', enabled: false },
              ],
              requiredCapabilities: { invocationMode: 'direct' },
            },
          ],
        }),
      'RESPONSIBILITY_DEFINITION_INVALID'
    );
  });

  it('composes Actor, Responsibility, and Step instructions in stable order', async () => {
    const calls = inspection();
    const actors = createActorCatalog({
      actors: [{ id: 'main', engineId: 'engine', instructions: 'Actor instructions' }],
      engines: [fakeEngine('engine', calls)],
    });
    const responsibilities = createResponsibilityCatalog({
      responsibilities: [
        {
          id: 'compose',
          instructions: 'Responsibility instructions',
          requiredCapabilities: { invocationMode: 'interaction' },
        },
      ],
    });
    const resolved = await createResponsibilityRouter({
      actorCatalog: actors,
      responsibilityCatalog: responsibilities,
    }).resolve(parseResponsibilityId('compose'));
    await resolved.interact(interactionRequest());
    expect(calls.interactionRequests[0]?.instructions).toBe(
      'Actor instructions\n\nResponsibility instructions\n\nStep instructions'
    );
  });

  it('never retries a second candidate after selected Actor failure', async () => {
    const primaryCalls = inspection();
    const secondaryCalls = inspection();
    const actors = createActorCatalog({
      actors: [
        { id: 'main', engineId: 'primary' },
        { id: 'secondary', engineId: 'secondary' },
      ],
      engines: [
        fakeEngine('primary', primaryCalls, { failInteraction: true }),
        fakeEngine('secondary', secondaryCalls),
      ],
    });
    const responsibilities = createResponsibilityCatalog({
      responsibilities: [
        {
          id: 'no-retry',
          actors: [
            { actorId: 'main', enabled: true },
            { actorId: 'secondary', enabled: true },
          ],
          requiredCapabilities: { invocationMode: 'interaction' },
        },
      ],
    });
    const resolved = await createResponsibilityRouter({
      actorCatalog: actors,
      responsibilityCatalog: responsibilities,
    }).resolve(parseResponsibilityId('no-retry'));
    await expect(resolved.interact(interactionRequest())).rejects.toThrow('primary failed');
    expect(primaryCalls.interactionRequests).toHaveLength(1);
    expect(secondaryCalls.interactionRequests).toHaveLength(0);
  });

  it('passes cancellation unchanged and returns immutable routing metadata', async () => {
    const calls = inspection();
    const actors = createActorCatalog({
      revision: 3,
      actors: [{ id: 'main', engineId: 'engine', allowedTools: ['search'] }],
      engines: [fakeEngine('engine', calls)],
    });
    const responsibilities = createResponsibilityCatalog({
      responsibilities: [
        {
          id: 'metadata',
          allowedTools: ['search'],
          requiredCapabilities: { invocationMode: 'interaction', cancellation: true },
        },
      ],
    });
    const resolved = await createResponsibilityRouter({
      actorCatalog: actors,
      responsibilityCatalog: responsibilities,
    }).resolve(parseResponsibilityId('metadata'));
    const controller = new AbortController();
    await resolved.interact({ ...interactionRequest(), signal: controller.signal });
    expect(calls.interactionRequests[0]?.signal).toBe(controller.signal);
    expect(resolved.actor.allowedTools).toEqual(['search']);
    expect(resolved.allowedTools).toEqual(['search']);
    expect(Object.isFrozen(resolved.effectiveCandidates)).toBe(true);
  });
});
