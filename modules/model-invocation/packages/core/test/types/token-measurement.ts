import { expectTypeOf } from 'vitest';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  TOKEN_MEASUREMENT_ACCURACY,
  type TextTokenInput,
  type TokenCounter,
  type TokenMeasurement,
  type TokenMeasurementInput,
} from '../../src/index.js';

interface ImageInput {
  readonly kind: 'image';
  readonly width: number;
}

const counter = createTokenCounter({
  measurementRef: 'test:utf16',
  inputContract: TEXT_TOKEN_INPUT_CONTRACT,
  measure: (input) =>
    Promise.resolve({
      tokens: input.text.length,
      accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
    }),
});

expectTypeOf(counter).toEqualTypeOf<TokenCounter<TextTokenInput>>();
expectTypeOf(counter.measure).parameter(0).toEqualTypeOf<TextTokenInput>();
expectTypeOf(counter.measure).parameter(1).toEqualTypeOf<AbortSignal>();
expectTypeOf(counter.measure).returns.toEqualTypeOf<Promise<TokenMeasurement>>();
expectTypeOf<TokenCounter<TextTokenInput>>().not.toExtend<TokenCounter<ImageInput>>();
expectTypeOf<TokenCounter<TextTokenInput>>().not.toExtend<TokenCounter<TokenMeasurementInput>>();
expectTypeOf<TokenCounter<TextTokenInput>>().not.toExtend<
  TokenCounter<TextTokenInput | ImageInput>
>();
expectTypeOf<TokenCounter<TextTokenInput | ImageInput>>().toExtend<TokenCounter<TextTokenInput>>();
