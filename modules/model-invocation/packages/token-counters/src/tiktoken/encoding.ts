import { TokenMeasurementError } from '@print-an-agent/model-invocation-core';

export const TIKTOKEN_ENCODING = Object.freeze({
  CL100K_BASE: 'cl100k_base',
  O200K_BASE: 'o200k_base',
} as const);

export type TiktokenEncoding = (typeof TIKTOKEN_ENCODING)[keyof typeof TIKTOKEN_ENCODING];

export interface TiktokenTextCounterOptions {
  readonly encoding: TiktokenEncoding;
}

export function parseTiktokenEncoding(encoding: unknown): TiktokenEncoding {
  if (encoding !== TIKTOKEN_ENCODING.CL100K_BASE && encoding !== TIKTOKEN_ENCODING.O200K_BASE) {
    throw new TokenMeasurementError(
      'TOKEN_MEASUREMENT_BINDING_INVALID',
      'An explicit supported tiktoken encoding is required.'
    );
  }
  return encoding;
}
