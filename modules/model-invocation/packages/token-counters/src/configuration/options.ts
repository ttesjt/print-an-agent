import type { CharacterTokenEstimatorOptions } from '../character-estimator.js';
import type { TiktokenTextCounterOptions } from '../tiktoken/index.js';

export const TEXT_TOKEN_COUNTER_KIND = Object.freeze({
  TIKTOKEN: 'tiktoken',
  CHARACTER_ESTIMATOR: 'character-estimator',
  REFERENCE: 'reference',
} as const);

type TiktokenConfig = Readonly<{ kind: typeof TEXT_TOKEN_COUNTER_KIND.TIKTOKEN }> &
  TiktokenTextCounterOptions;
type CharacterEstimatorConfigInput = Readonly<{
  kind: typeof TEXT_TOKEN_COUNTER_KIND.CHARACTER_ESTIMATOR;
}> &
  CharacterTokenEstimatorOptions;
type ReferenceConfig = Readonly<{
  kind: typeof TEXT_TOKEN_COUNTER_KIND.REFERENCE;
  measurementRef: string;
}>;

export type TextTokenCounterConfigInput =
  | TiktokenConfig
  | CharacterEstimatorConfigInput
  | ReferenceConfig;
export type TextTokenCounterConfig =
  | TiktokenConfig
  | (Readonly<{ kind: typeof TEXT_TOKEN_COUNTER_KIND.CHARACTER_ESTIMATOR }> &
      Required<CharacterTokenEstimatorOptions>)
  | ReferenceConfig;
