import type { ToolName } from '../types/identity.js';

export interface ToolPermissionPolicyInput {
  readonly responsibility: readonly string[];
  readonly actor: readonly string[];
  readonly product: readonly string[];
  readonly runtime: readonly string[];
}

export interface ToolPermissionPolicy {
  readonly responsibility: readonly ToolName[];
  readonly actor: readonly ToolName[];
  readonly product: readonly ToolName[];
  readonly runtime: readonly ToolName[];
}
