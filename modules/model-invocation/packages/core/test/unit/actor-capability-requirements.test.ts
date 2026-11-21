import { expect, it } from 'vitest';
import {
  defineActorEngineCapabilities,
  satisfiesActorRequirements,
  validateActorCapabilityRequirements,
} from '../../src/index.js';

it.each([
  [null, 'object-required'],
  ['invalid', 'object-required'],
  [{}, 'definition-invalid'],
  [{ invocationMode: 'unknown' }, 'definition-invalid'],
  [{ invocationMode: 'direct', extra: true }, 'definition-invalid'],
  [{ invocationMode: 'direct', interaction: { streamable: true } }, 'interaction-invalid'],
  [{ invocationMode: 'interaction', interaction: { streamable: false } }, 'interaction-invalid'],
  [
    { invocationMode: 'interaction', interaction: { streamable: true, extra: true } },
    'interaction-invalid',
  ],
  [{ invocationMode: 'direct', inputMediaTypes: [] }, 'media-types-invalid'],
  [{ invocationMode: 'direct', inputMediaTypes: ['text', 'text'] }, 'media-types-invalid'],
  [{ invocationMode: 'direct', inputMediaTypes: ['unsupported'] }, 'media-types-invalid'],
  [{ invocationMode: 'direct', toolCalling: false }, 'toolCalling'],
  [{ invocationMode: 'direct', structuredOutput: false }, 'structuredOutput'],
  [{ invocationMode: 'direct', cancellation: false }, 'cancellation'],
  [{ invocationMode: 'direct', minimumContextTokens: 0 }, 'context-tokens-invalid'],
  [
    { invocationMode: 'direct', minimumContextTokens: Number.MAX_SAFE_INTEGER + 1 },
    'context-tokens-invalid',
  ],
])('returns a domain-neutral diagnostic for %j', (input, issue) => {
  const result: unknown = Reflect.apply(validateActorCapabilityRequirements, undefined, [input]);
  expect(result).toEqual({ valid: false, issue });
  expect(Object.isFrozen(result)).toBe(true);
});

it.each(['direct', 'interaction', 'stream'] as const)(
  'accepts independent %s selection requirements',
  (invocationMode) => {
    const result = validateActorCapabilityRequirements({ invocationMode });
    expect(result).toEqual({ valid: true, value: { invocationMode } });
  }
);

it('owns a frozen normalized value usable by the existing capability matcher', () => {
  const media = ['text' as const];
  const interaction = { streamable: true as const };
  const result = validateActorCapabilityRequirements({
    invocationMode: 'interaction',
    inputMediaTypes: media,
    interaction,
    toolCalling: true,
    structuredOutput: true,
    cancellation: true,
    minimumContextTokens: 100,
  });
  if (!result.valid) throw new Error(`Unexpected diagnostic: ${result.issue}`);
  media.push('text');
  expect(result.value.inputMediaTypes).toEqual(['text']);
  expect(result.value.interaction).not.toBe(interaction);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.value)).toBe(true);
  expect(Object.isFrozen(result.value.inputMediaTypes)).toBe(true);
  expect(Object.isFrozen(result.value.interaction)).toBe(true);
  const capabilities = defineActorEngineCapabilities({
    invocationModes: ['interaction'],
    inputMediaTypes: ['text'],
    interaction: { streamable: true },
    toolCalling: true,
    structuredOutput: true,
    cancellation: true,
    maxContextTokens: 200,
  });
  expect(satisfiesActorRequirements(capabilities, result.value)).toBe(true);
  expect(satisfiesActorRequirements({ ...capabilities, maxContextTokens: 99 }, result.value)).toBe(
    false
  );
});
