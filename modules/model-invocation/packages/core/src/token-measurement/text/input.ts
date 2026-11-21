import { TOKEN_MEASUREMENT_SCOPE } from '../options.js';
import type { TokenInputContract } from '../types/input.js';
import { TokenMeasurementError } from '../errors.js';
import { readClosedRecord } from '../validation.js';

export const TOKEN_INPUT_KIND = Object.freeze({ TEXT: 'text' } as const);
function normalizeTextTokenInput(input: unknown) {
  const code = 'TOKEN_MEASUREMENT_INPUT_INVALID';
  const record = readClosedRecord(input, ['kind', 'text'], code);
  if (record.kind !== TOKEN_INPUT_KIND.TEXT || typeof record.text !== 'string') {
    throw new TokenMeasurementError(code, 'Text input requires a text kind and string content.');
  }
  // Do not trim or normalize: the exact supplied text is the measurement subject.
  return Object.freeze({ kind: TOKEN_INPUT_KIND.TEXT, text: record.text });
}

export type TextTokenInput = ReturnType<typeof normalizeTextTokenInput>;

export function parseTextTokenInput(input: unknown): TextTokenInput {
  return normalizeTextTokenInput(input);
}

export const TEXT_TOKEN_INPUT_CONTRACT: TokenInputContract<TextTokenInput> = Object.freeze({
  ref: 'token-input:text',
  scope: TOKEN_MEASUREMENT_SCOPE.TEXT,
  inputKinds: Object.freeze([TOKEN_INPUT_KIND.TEXT]),
  parse: parseTextTokenInput,
});
