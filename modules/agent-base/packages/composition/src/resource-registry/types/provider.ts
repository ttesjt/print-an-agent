import type { ResourceTokenIdentity } from '../token.js';

export interface PreparedDependency {
  readonly name: string;
  readonly token: ResourceTokenIdentity;
  readonly binding: unknown;
}
export interface PreparedProvider {
  readonly key: string;
  readonly descriptor: string;
  readonly dependencies: readonly PreparedDependency[];
  create(
    dependencies: Readonly<Record<string, unknown>>,
    signal: AbortSignal
  ): Promise<{ readonly acquisition: unknown }>;
  validate(value: unknown): Promise<void>;
}
export interface ProviderDriver {
  readonly token: ResourceTokenIdentity;
  readonly dependencyTokens: readonly ResourceTokenIdentity[];
  readonly externalBinding: 'forbidden' | 'borrowed';
  prepare(binding: unknown): PreparedProvider;
}
