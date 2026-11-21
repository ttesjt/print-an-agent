import type { TokenMeasurementScope, TokenMeasurementAccuracy } from '../options.js';

/** Exactness applies only to the bound protocol, scope and measurement identity. */
export interface TokenCountResult {
  readonly tokens: number;
  readonly accuracy: TokenMeasurementAccuracy;
}

export interface TokenMeasurement extends TokenCountResult {
  readonly measurementRef: string;
  readonly inputProtocolRef: string;
  readonly scope: TokenMeasurementScope;
}

/** Specified fields require equality; there is no implicit accuracy or scope conversion. */
export interface TokenMeasurementRequirements {
  readonly measurementRef?: string;
  readonly inputProtocolRef?: string;
  readonly scope?: TokenMeasurementScope;
  readonly accuracy?: TokenMeasurementAccuracy;
}
