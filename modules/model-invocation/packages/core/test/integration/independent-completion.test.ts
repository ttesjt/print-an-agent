import { describe, expect, it } from 'vitest';
import {
  ActorError,
  createActor,
  requireCompletionCapability,
  requireInteractionCapability,
} from '../../src/index.js';
import { assistantMessage } from '../support/model.js';

const capabilities = {
  invocationModes: ['direct'] as const,
  inputMediaTypes: ['text'] as const,
  cancellation: true,
  structuredOutput: false,
  toolCalling: false,
};

describe('independent Completion consumer', () => {
  it('enforces a Completion budget even for a custom Engine', async () => {
    const actor = requireCompletionCapability(
      createActor({
        id: 'bounded',
        engine: {
          id: 'engine',
          capabilities,
          complete: () => Promise.resolve({ message: assistantMessage('too long') }),
        },
      })
    );
    await expect(
      actor.complete({
        instructions: '',
        messages: [],
        maxOutputCharacters: 2,
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_LIMIT_EXCEEDED' });
  });
  it('calls a named Actor without a catalog, Agent, Session or tools', async () => {
    const actor = requireCompletionCapability(
      createActor({
        id: 'memory-proposer',
        instructions: 'Remember useful facts.',
        engine: {
          id: 'local-engine',
          capabilities,
          complete: (request) => {
            expect(request.instructions).toBe('Remember useful facts.\n\nPropose an update.');
            expect(request).not.toHaveProperty('tools');
            return Promise.resolve({ message: assistantMessage('A useful fact.') });
          },
        },
      })
    );
    expect(actor).not.toHaveProperty('interact');
    expect(actor).not.toHaveProperty('catalogRevision');
    expect(() => requireInteractionCapability(actor)).toThrow(ActorError);
    await expect(
      actor.complete({
        instructions: 'Propose an update.',
        messages: [],
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
      })
    ).resolves.toMatchObject({ message: { text: 'A useful fact.' } });
  });

  it('does not expose completion for a native interaction-only Engine', () => {
    const actor = createActor({
      id: 'interactive',
      engine: {
        id: 'native',
        capabilities: {
          ...capabilities,
          invocationModes: ['interaction'],
          interaction: { streamable: false },
        },
        interact: async (request) => {
          const message = assistantMessage('done');
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
      },
    });
    expect(actor).not.toHaveProperty('complete');
    expect(requireInteractionCapability(actor).interact).toBeTypeOf('function');
  });
});
