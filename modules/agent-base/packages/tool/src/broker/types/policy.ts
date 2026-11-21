export interface ToolExecutionPolicy {
  readonly maxToolCalls: number;
  readonly toolTimeoutMilliseconds: number;
  readonly maxArgumentCharacters: number;
  readonly maxResultCharacters: number;
  readonly maxTotalResultCharacters: number;
}
