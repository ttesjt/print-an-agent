export const EMBEDDING_TASK = Object.freeze({ DOCUMENT: 'document', QUERY: 'query' } as const);

export type EmbeddingTask = (typeof EMBEDDING_TASK)[keyof typeof EMBEDDING_TASK];
