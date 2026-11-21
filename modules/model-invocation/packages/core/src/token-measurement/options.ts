export const TOKEN_MEASUREMENT_ACCURACY = Object.freeze({
  EXACT: 'exact',
  ESTIMATED: 'estimated',
} as const);

export type TokenMeasurementAccuracy =
  (typeof TOKEN_MEASUREMENT_ACCURACY)[keyof typeof TOKEN_MEASUREMENT_ACCURACY];

export const TOKEN_MEASUREMENT_SCOPE = Object.freeze({
  TEXT: 'text',
  CONTENT: 'content',
  REQUEST: 'request',
} as const);

export type TokenMeasurementScope =
  (typeof TOKEN_MEASUREMENT_SCOPE)[keyof typeof TOKEN_MEASUREMENT_SCOPE];
