/** Deterministic vectors prove the wire protocol, not semantic model quality. */
export function wireResponse(): {
  object: string;
  model: string;
  data: { object: string; index: number; embedding: number[] }[];
  usage: { prompt_tokens: number; total_tokens: number };
} {
  return {
    object: 'list',
    model: 'test-embedding',
    data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
    usage: { prompt_tokens: 1, total_tokens: 1 },
  };
}
