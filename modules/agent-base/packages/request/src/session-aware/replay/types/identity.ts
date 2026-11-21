declare const requestIdempotencyKeyBrand: unique symbol;

declare const requestFingerprintBrand: unique symbol;

export type RequestIdempotencyKey = string & {
  readonly [requestIdempotencyKeyBrand]: 'RequestIdempotencyKey';
};

export type RequestFingerprint = string & {
  readonly [requestFingerprintBrand]: 'RequestFingerprint';
};
