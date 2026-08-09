import { definePiProviderConfig } from '@ta-agent/base-pi';
import type { DefinedProviderConfig } from './provider-contracts.js';

export function defineProviderConfig(input: unknown): DefinedProviderConfig {
  return definePiProviderConfig(input);
}
