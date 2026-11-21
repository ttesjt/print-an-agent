import { isPromise } from 'node:util/types';
import type {
  TokenCounter,
  TokenCounterDefinition,
  TokenCounterDescriptor,
} from './types/counter.js';
import type { TokenInputContract, TokenMeasurementInput } from './types/input.js';
import { hasMeasurementErrorCode, TokenMeasurementError } from './errors.js';
import { bindTokenMeasurement } from './result.js';
import {
  parseInputKinds,
  parseMeasurementReference,
  parseMeasurementScope,
  readClosedRecord,
  readTokenInputKind,
} from './validation.js';

function isInputParser<TInput extends TokenMeasurementInput>(
  value: unknown
): value is TokenInputContract<TInput>['parse'] {
  // The trusted SPI parser owns the payload schema; execution validates its kind separately.
  return typeof value === 'function';
}

function normalizeDefinition<TInput extends TokenMeasurementInput>(
  definition: TokenCounterDefinition<TInput>
) {
  const code = 'TOKEN_MEASUREMENT_BINDING_INVALID';
  try {
    const record = readClosedRecord(
      definition,
      ['measurementRef', 'inputContract', 'measure'],
      code
    );
    const inputContract = readClosedRecord(
      record.inputContract,
      ['ref', 'scope', 'inputKinds', 'parse'],
      code
    );
    const parser = inputContract.parse;
    const implementation = record.measure;
    if (!isInputParser<TInput>(parser) || typeof implementation !== 'function') {
      throw new TokenMeasurementError(
        code,
        'Counter requires a parser and counting implementation.'
      );
    }
    const descriptor: TokenCounterDescriptor = Object.freeze({
      measurementRef: parseMeasurementReference(record.measurementRef, code),
      inputProtocolRef: parseMeasurementReference(inputContract.ref, code),
      scope: parseMeasurementScope(inputContract.scope, code),
      inputKinds: parseInputKinds(inputContract.inputKinds),
    });
    return {
      descriptor,
      parse: parser.bind(record.inputContract),
      invoke: async (input: TInput, signal: AbortSignal): Promise<unknown> => {
        const result: unknown = Reflect.apply(implementation, definition, [input, signal]);
        return await result;
      },
    };
  } catch (cause: unknown) {
    if (hasMeasurementErrorCode(cause, [code])) throw cause;
    throw new TokenMeasurementError(code, 'Token counter binding could not be inspected.', {
      cause,
    });
  }
}

async function parseCounterInput<TInput extends TokenMeasurementInput>(
  input: unknown,
  descriptor: TokenCounterDescriptor,
  parse: TokenInputContract<TInput>['parse']
): Promise<Readonly<{ input: TInput }>> {
  try {
    const kind = readTokenInputKind(input);
    if (!descriptor.inputKinds.includes(kind)) {
      throw new TokenMeasurementError(
        'TOKEN_MEASUREMENT_INPUT_UNSUPPORTED',
        'This counter does not support the input kind.'
      );
    }
    const parsed = parse(input);
    if (isPromise(parsed)) {
      // A JavaScript SPI may violate the synchronous contract. Observe/join its work before
      // rejecting it. Native brand checking covers other realms without inspecting payload.then;
      // the intrinsic also avoids invoking a Promise's overridden then property.
      await Promise.prototype.then.call(
        parsed,
        () => undefined,
        () => undefined
      );
      throw new TokenMeasurementError(
        'TOKEN_MEASUREMENT_INPUT_INVALID',
        'Token input parsers must be synchronous.'
      );
    }
    if (readTokenInputKind(parsed) !== kind) {
      throw new TokenMeasurementError(
        'TOKEN_MEASUREMENT_INPUT_INVALID',
        'Input parser changed the input kind.'
      );
    }
    // Do not assimilate a custom payload's possible `then` field as a returned Promise.
    return { input: parsed };
  } catch (cause: unknown) {
    if (
      hasMeasurementErrorCode(cause, [
        'TOKEN_MEASUREMENT_INPUT_INVALID',
        'TOKEN_MEASUREMENT_INPUT_UNSUPPORTED',
      ])
    ) {
      throw cause;
    }
    throw new TokenMeasurementError(
      'TOKEN_MEASUREMENT_INPUT_INVALID',
      'Input does not satisfy the bound token input protocol.',
      { cause }
    );
  }
}

export function createTokenCounter<TInput extends TokenMeasurementInput>(
  definition: TokenCounterDefinition<TInput>
): TokenCounter<TInput> {
  const { descriptor, parse, invoke } = normalizeDefinition(definition);
  return Object.freeze({
    descriptor,
    async measure(input: TInput, signal: AbortSignal) {
      if (!(signal instanceof AbortSignal)) {
        throw new TokenMeasurementError(
          'TOKEN_MEASUREMENT_INPUT_INVALID',
          'Token measurement requires an AbortSignal.'
        );
      }
      signal.throwIfAborted();
      let parsed: TInput;
      try {
        parsed = (await parseCounterInput(input, descriptor, parse)).input;
      } catch (cause: unknown) {
        signal.throwIfAborted();
        throw cause;
      }
      signal.throwIfAborted();
      let result: unknown;
      try {
        result = await invoke(parsed, signal);
      } catch (cause: unknown) {
        signal.throwIfAborted();
        if (hasMeasurementErrorCode(cause)) throw cause;
        throw new TokenMeasurementError(
          'TOKEN_MEASUREMENT_FAILED',
          'Token measurement implementation failed.',
          { cause }
        );
      }
      signal.throwIfAborted();
      try {
        const measurement = bindTokenMeasurement(result, descriptor);
        signal.throwIfAborted();
        return measurement;
      } catch (cause: unknown) {
        signal.throwIfAborted();
        throw cause;
      }
    },
  });
}
