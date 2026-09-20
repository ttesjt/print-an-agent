import { describe, expect, it } from 'vitest';
import {
  defineSessionTurnPresentation,
  MAX_SESSION_PRESENTATION_CHARACTERS,
  MAX_SESSION_PRESENTATION_BLOCKS,
} from '../../src/index.js';

describe('Session presentation value', () => {
  it('normalizes a detached frozen display-only value with an exact storage bound', async () => {
    const block = { modelTurnIndex: 1, text: 'r'.repeat(MAX_SESSION_PRESENTATION_CHARACTERS) };
    const input = { reasoningBlocks: [block] };
    const value = defineSessionTurnPresentation(input);
    block.text = 'changed';
    input.reasoningBlocks.length = 0;
    expect(value.reasoningBlocks[0]?.text).toHaveLength(MAX_SESSION_PRESENTATION_CHARACTERS);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.reasoningBlocks)).toBe(true);
    expect(Object.isFrozen(value.reasoningBlocks[0])).toBe(true);
    await expect(
      Promise.resolve().then(() =>
        defineSessionTurnPresentation({
          reasoningBlocks: [...value.reasoningBlocks, { modelTurnIndex: 2, text: 'x' }],
        })
      )
    ).rejects.toMatchObject({ code: 'SESSION_PRESENTATION_LIMIT_EXCEEDED' });
  });

  it.each([
    null,
    [],
    {},
    { reasoning: '' },
    { reasoningBlocks: [] },
    { reasoningBlocks: [{ modelTurnIndex: 1, text: '' }] },
    { reasoningBlocks: [{ modelTurnIndex: 0, text: 'x' }] },
    { reasoningBlocks: [{ modelTurnIndex: 1.5, text: 'x' }] },
    { reasoningBlocks: [{ modelTurnIndex: Infinity, text: 'x' }] },
    { reasoningBlocks: [{ modelTurnIndex: 1, text: 'x', signature: 'secret' }] },
    {
      reasoningBlocks: [
        { modelTurnIndex: 2, text: 'a' },
        { modelTurnIndex: 1, text: 'b' },
      ],
    },
    {
      reasoningBlocks: [
        { modelTurnIndex: 1, text: 'a' },
        { modelTurnIndex: 1, text: 'b' },
      ],
    },
    { reasoningBlocks: new Array<unknown>(1) },
    Object.create({ reasoningBlocks: [] }),
    Object.defineProperty({}, 'reasoningBlocks', {
      enumerable: true,
      get() {
        throw new Error('getter must not run');
      },
    }),
  ])('rejects invalid presentation without evaluating accessors', async (input: unknown) => {
    await expect(
      Promise.resolve().then(() => defineSessionTurnPresentation(input))
    ).rejects.toMatchObject({ code: 'SESSION_PRESENTATION_INVALID' });
  });

  it('bounds block count and preserves increasing ordinals with gaps', async () => {
    const blocks = Array.from({ length: MAX_SESSION_PRESENTATION_BLOCKS }, (_, i) => ({
      modelTurnIndex: i * 2 + 1,
      text: 'x',
    }));
    expect(defineSessionTurnPresentation({ reasoningBlocks: blocks }).reasoningBlocks).toEqual(
      blocks
    );
    await expect(
      Promise.resolve().then(() =>
        defineSessionTurnPresentation({
          reasoningBlocks: [...blocks, { modelTurnIndex: 9999, text: 'x' }],
        })
      )
    ).rejects.toMatchObject({ code: 'SESSION_PRESENTATION_LIMIT_EXCEEDED' });
  });

  it('rejects nested block and array accessors without invoking them', async () => {
    const getter = {
      enumerable: true,
      get() {
        throw new Error('must not evaluate');
      },
    };
    const block = Object.defineProperty({ modelTurnIndex: 1 }, 'text', getter);
    const blocks = Object.defineProperty([undefined], '0', getter);
    for (const reasoningBlocks of [[block], blocks]) {
      await expect(
        Promise.resolve().then(() => defineSessionTurnPresentation({ reasoningBlocks }))
      ).rejects.toMatchObject({ code: 'SESSION_PRESENTATION_INVALID' });
    }
  });
});
