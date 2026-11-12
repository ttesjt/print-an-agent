import { definePiProviderConfig } from '@print-an-agent/model-invocation-pi';
import type { DefinedProviderConfig } from './provider-contracts.js';

export function defineProviderConfig(input: unknown): DefinedProviderConfig {
  return definePiProviderConfig(input);
}
