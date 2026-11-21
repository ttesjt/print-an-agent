import type { TextTokenInput } from './input.js';
import type { TokenCounter } from '../types/counter.js';
import { TOKEN_INPUT_KIND } from './input.js';
import { TOKEN_MEASUREMENT_SCOPE } from '../options.js';
import { createTokenCounter } from '../counter.js';
import { TokenMeasurementError, hasMeasurementErrorCode } from '../errors.js';
import { requireTokenMeasurement } from '../requirements.js';
import { TEXT_TOKEN_INPUT_CONTRACT } from './input.js';
import { parseInputKinds, parseMeasurementReference, readClosedRecord } from '../validation.js';

/** Borrow a text capability, freezing identity and validating each returned measurement. */
export function bindTextTokenCounter(input: unknown): TokenCounter<TextTokenInput> {
  const code = 'TOKEN_MEASUREMENT_BINDING_INVALID';
  try {
    if (
      typeof input !== 'object' ||
      input === null ||
      !('measure' in input) ||
      typeof input.measure !== 'function' ||
      !('descriptor' in input)
    )
      throw new TokenMeasurementError(code, 'A text token counting capability is required.');
    const descriptor = readClosedRecord(
      input.descriptor,
      ['measurementRef', 'inputProtocolRef', 'scope', 'inputKinds'],
      code
    );
    const measurementRef = parseMeasurementReference(descriptor.measurementRef, code);
    const inputKinds = parseInputKinds(descriptor.inputKinds);
    if (
      descriptor.inputProtocolRef !== TEXT_TOKEN_INPUT_CONTRACT.ref ||
      descriptor.scope !== TOKEN_MEASUREMENT_SCOPE.TEXT ||
      inputKinds.length !== 1 ||
      inputKinds[0] !== TOKEN_INPUT_KIND.TEXT
    ) {
      throw new TokenMeasurementError(
        code,
        'Binding requires the standard standalone-text protocol and scope.'
      );
    }
    const measure = input.measure;
    return createTokenCounter({
      measurementRef,
      inputContract: TEXT_TOKEN_INPUT_CONTRACT,
      measure: async (subject, signal) => {
        const measured: unknown = Reflect.apply(measure, input, [subject, signal]);
        const result = requireTokenMeasurement(await measured, {
          measurementRef,
          inputProtocolRef: TEXT_TOKEN_INPUT_CONTRACT.ref,
          scope: TOKEN_MEASUREMENT_SCOPE.TEXT,
        });
        return { tokens: result.tokens, accuracy: result.accuracy };
      },
    });
  } catch (cause: unknown) {
    if (hasMeasurementErrorCode(cause, [code])) throw cause;
    throw new TokenMeasurementError(code, 'Text counter binding could not be inspected.', {
      cause,
    });
  }
}
