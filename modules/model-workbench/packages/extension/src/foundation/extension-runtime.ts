import type { JsonValue, Sha256Digest } from '@ta-agent/workbench-domain';

export interface ExtensionCallOptions {
  readonly signal?: AbortSignal;
}

export interface WorkbenchExtensionRuntime<TFamily extends string, TKind extends string> {
  readonly family: TFamily;
  readonly kind: TKind;
  readonly metadata?: JsonValue;
  readonly evidenceDigest: Sha256Digest;
}
