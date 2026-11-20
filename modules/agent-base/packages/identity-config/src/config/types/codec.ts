export type ConfigValue =
  | null
  | boolean
  | number
  | string
  | readonly ConfigValue[]
  | Readonly<{ [key: string]: ConfigValue }>;

export interface AgentConfigCodec<TConfig> {
  readonly schemaVersion: number;
  decode(value: unknown): TConfig;
  encode(config: TConfig): ConfigValue;
}
