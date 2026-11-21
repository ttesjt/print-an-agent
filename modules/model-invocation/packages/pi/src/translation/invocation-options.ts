import type { StreamOptions } from '@earendil-works/pi-ai';
import type { ActorInvocationConfig } from '@print-an-agent/model-invocation-core';

export function toPiInvocationOptions(
  config: ActorInvocationConfig,
  apiKey: string | undefined
): Pick<StreamOptions, 'temperature' | 'maxTokens' | 'apiKey'> {
  return {
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.maxOutputTokens === undefined ? {} : { maxTokens: config.maxOutputTokens }),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

export function invocationConfigFromPiOptions(
  options: StreamOptions | undefined
): ActorInvocationConfig {
  return Object.freeze({
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options?.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
  });
}
