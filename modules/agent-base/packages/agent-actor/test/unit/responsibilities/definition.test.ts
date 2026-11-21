import { expect, it } from 'vitest';
import { AgentActorError, defineResponsibility } from '../../../src/index.js';

it.each([
  [null, 'Responsibility requiredCapabilities must be an object.'],
  [{ invocationMode: 'unknown' }, 'Responsibility requiredCapabilities is invalid.'],
  [
    { invocationMode: 'direct', interaction: { streamable: true } },
    'Responsibility interaction requirement must require streamable interaction mode.',
  ],
  [
    { invocationMode: 'direct', inputMediaTypes: [] },
    'Responsibility inputMediaTypes must contain unique supported values.',
  ],
  [
    { invocationMode: 'direct', toolCalling: false },
    'Responsibility toolCalling requirement can only require true.',
  ],
  [
    { invocationMode: 'direct', structuredOutput: false },
    'Responsibility structuredOutput requirement can only require true.',
  ],
  [
    { invocationMode: 'direct', cancellation: false },
    'Responsibility cancellation requirement can only require true.',
  ],
  [
    { invocationMode: 'direct', minimumContextTokens: 0 },
    'Responsibility minimumContextTokens must be a positive safe integer.',
  ],
])(
  'retains the Responsibility error contract for Core diagnostic %j',
  (requiredCapabilities, message) => {
    let failure: unknown;
    try {
      Reflect.apply(defineResponsibility, undefined, [{ id: 'answer', requiredCapabilities }]);
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AgentActorError);
    expect(failure).toMatchObject({ code: 'RESPONSIBILITY_DEFINITION_INVALID', message });
    if (!(failure instanceof AgentActorError)) throw new Error('Expected Agent Actor error.');
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  }
);

it('preserves an unexpected input-access failure without translating it', () => {
  const cause = new Error('input unavailable');
  const requiredCapabilities: unknown = Object.defineProperty({}, 'invocationMode', {
    enumerable: true,
    get() {
      throw cause;
    },
  });
  let failure: unknown;
  try {
    Reflect.apply(defineResponsibility, undefined, [{ id: 'answer', requiredCapabilities }]);
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBe(cause);
});
