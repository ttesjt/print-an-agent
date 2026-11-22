import type * as Api from '@print-an-agent/model-invocation-token-counters';
import type { TokenCounter, TextTokenInput } from '@print-an-agent/model-invocation-core';
import {
  defineTextTokenCounterConfig,
  resolveTextTokenCounterConfig,
} from '@print-an-agent/model-invocation-token-counters';

export type PublicApi = {
  createCharacterTokenEstimator: typeof Api.createCharacterTokenEstimator;
  DEFAULT_CHARACTERS_PER_TOKEN: typeof Api.DEFAULT_CHARACTERS_PER_TOKEN;
  CharacterTokenEstimatorOptions: Api.CharacterTokenEstimatorOptions;
  createTiktokenTextCounter: typeof Api.createTiktokenTextCounter;
  TIKTOKEN_ENCODING: typeof Api.TIKTOKEN_ENCODING;
  TiktokenEncoding: Api.TiktokenEncoding;
  TiktokenTextCounterOptions: Api.TiktokenTextCounterOptions;
  defineTextTokenCounterConfig: typeof Api.defineTextTokenCounterConfig;
  resolveTextTokenCounterConfig: typeof Api.resolveTextTokenCounterConfig;
  TEXT_TOKEN_COUNTER_KIND: typeof Api.TEXT_TOKEN_COUNTER_KIND;
  TextTokenCounterConfigInput: Api.TextTokenCounterConfigInput;
  TextTokenCounterConfig: Api.TextTokenCounterConfig;
  TextTokenCounterReferenceResolver: Api.TextTokenCounterReferenceResolver;
};
function configurationContracts(
  input: Api.TextTokenCounterConfigInput,
  resolver: Api.TextTokenCounterReferenceResolver
): TokenCounter<TextTokenInput> {
  const config = defineTextTokenCounterConfig(input);
  if (input.kind === 'character-estimator') {
    const optional: number | undefined = input.charactersPerToken;
    void optional;
  }
  if (config.kind === 'character-estimator') {
    const normalized: number = config.charactersPerToken;
    void normalized;
    // @ts-expect-error Normalized configuration retains readonly fields.
    config.charactersPerToken = 2;
  }
  if (config.kind === 'reference') {
    // @ts-expect-error Named bindings do not carry tokenizer encoding options.
    void config.encoding;
  }
  const asynchronous = (ref: string) => Promise.resolve(resolver(ref));
  // @ts-expect-error Reference lookup must synchronously return an existing capability.
  const synchronous: Api.TextTokenCounterReferenceResolver = asynchronous;
  void synchronous;
  return resolveTextTokenCounterConfig(config, resolver);
}
void configurationContracts;
