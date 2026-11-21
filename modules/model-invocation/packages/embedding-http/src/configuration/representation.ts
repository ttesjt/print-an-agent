import type { PreparedHttpEmbeddingConfig, HttpEmbeddingRepresentationInput } from './types.js';

const HTTP_EMBEDDING_RECIPE_REF = Object.freeze({
  MODEL_DEFAULT_DIMENSIONS: 'openai-compatible:float:model-default-dimensions',
  EXPLICIT_DIMENSIONS: 'openai-compatible:float:explicit-dimensions',
});

export function prepareHttpEmbeddingRepresentation(
  config: PreparedHttpEmbeddingConfig
): HttpEmbeddingRepresentationInput {
  const recipeRef = config.target.sendDimensions
    ? HTTP_EMBEDDING_RECIPE_REF.EXPLICIT_DIMENSIONS
    : HTTP_EMBEDDING_RECIPE_REF.MODEL_DEFAULT_DIMENSIONS;
  return {
    modelRef: config.representation.modelRef,
    dimensions: config.representation.dimensions,
    preprocessingRef: 'unicode-text:identity',
    documentRecipeRef: recipeRef,
    queryRecipeRef: recipeRef,
    outputTransformRef: 'provider-numbers:identity',
  };
}
