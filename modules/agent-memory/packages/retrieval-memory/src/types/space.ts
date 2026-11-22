export interface IndexConfiguration {
  readonly embeddingRef: string;
  readonly chunkerRef: string;
  readonly metricRef: string;
}

export interface RetrievalSpace {
  readonly memoryId: string;
  readonly revision: number;
  readonly sequence: number;
  readonly index: IndexConfiguration & {
    readonly generationId: string;
    readonly dimensions: number;
  };
}
