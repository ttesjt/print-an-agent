/** Execution concerns for one management Service call; never part of a domain command. */
export interface ManagementOperationOptions {
  readonly signal?: AbortSignal;
}
