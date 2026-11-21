import type * as Api from '@print-an-agent/model-invocation-embedding-http';
import type { TextEmbeddingCapability } from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '@print-an-agent/model-invocation-embedding-http';

export type PublicApi = {
  createHttpTextEmbedder: typeof Api.createHttpTextEmbedder;
  CreateHttpTextEmbedderOptions: Api.CreateHttpTextEmbedderOptions;
  HttpEmbeddingAuthentication: Api.HttpEmbeddingAuthentication;
  HttpTextEmbeddingConfig: Api.HttpTextEmbeddingConfig;
};

function publicContracts(options: Api.CreateHttpTextEmbedderOptions): TextEmbeddingCapability {
  const authentication = options.config.authentication;
  if (authentication.kind === 'credential-reference') {
    const reference: string = authentication.credentialRef;
    void reference;
  } else {
    // @ts-expect-error Keyless authentication has no credential reference.
    void authentication.credentialRef;
  }
  // @ts-expect-error Factory options retain their readonly contract.
  options.config = { ...options.config };
  return createHttpTextEmbedder(options);
}
void publicContracts;
