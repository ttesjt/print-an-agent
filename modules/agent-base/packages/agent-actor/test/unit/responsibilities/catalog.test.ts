import { expect, it } from 'vitest';
import { createResponsibilityCatalog, parseResponsibilityId } from '../../../src/index.js';

it.each([0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid catalog revision %s',
  (revision) => {
    expect(() => createResponsibilityCatalog({ revision, responsibilities: [] })).toThrow(
      'positive safe integer'
    );
  }
);
it('owns immutable detached definition snapshots without mutating its input', async () => {
  const actors = [{ actorId: 'main', enabled: true }];
  const tools = ['search'];
  const media = ['text' as const];
  const catalog = createResponsibilityCatalog({
    revision: 4,
    responsibilities: [
      {
        id: 'answer',
        actors,
        allowedTools: tools,
        requiredCapabilities: { invocationMode: 'direct', inputMediaTypes: media },
      },
    ],
  });
  actors[0] = { actorId: 'other', enabled: false };
  tools.push('edit');
  media.push('text');
  const first = await catalog.resolve(parseResponsibilityId('answer'));
  const second = await catalog.resolve(first.id);
  expect(catalog.revision).toBe(4);
  expect(first).not.toBe(second);
  expect(first.actors).toEqual([{ actorId: 'main', enabled: true }]);
  expect(first.allowedTools).toEqual(['search']);
  expect(first.requiredCapabilities.inputMediaTypes).toEqual(['text']);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.actors)).toBe(true);
  expect(Object.isFrozen(first.requiredCapabilities.inputMediaTypes)).toBe(true);
  const listed = catalog.list();
  expect(listed).toEqual([first]);
  expect(listed[0]).not.toBe(first);
  expect(Object.isFrozen(listed)).toBe(true);
  expect(Object.isFrozen(tools)).toBe(false);
});
