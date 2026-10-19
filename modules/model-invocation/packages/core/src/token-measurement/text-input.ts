import {
  TOKEN_INPUT_KIND,
  TOKEN_MEASUREMENT_SCOPE,
  type TextTokenInput,
  type TokenInputContract,
} from './contracts.js';
import { TokenMeasurementError } from './errors.js';
import { readClosedRecord } from './validation.js';

export function parseTextTokenInput(input: unknown): TextTokenInput {
  const code = 'TOKEN_MEASUREMENT_INPUT_INVALID';
  const record = readClosedRecord(input, ['kind', 'text'], code);
  if (record.kind !== TOKEN_INPUT_KIND.TEXT || typeof record.text !== 'string') {
    throw new TokenMeasurementError(code, 'Text input requires a text kind and string content.');
  }
  // Do not trim or normalize: the exact supplied text is the measurement subject.
  return Object.freeze({ kind: TOKEN_INPUT_KIND.TEXT, text: record.text });
}

export const TEXT_TOKEN_INPUT_CONTRACT: TokenInputContract<TextTokenInput> = Object.freeze({
  ref: 'token-input:text',
  scope: TOKEN_MEASUREMENT_SCOPE.TEXT,
  inputKinds: Object.freeze([TOKEN_INPUT_KIND.TEXT]),
  parse: parseTextTokenInput,
});
