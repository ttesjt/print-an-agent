import type { SqliteAgentConfigTableNamingInput } from './table-names.js';

export interface SqliteAgentConfigAdapterOptions extends SqliteAgentConfigTableNamingInput {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds?: number;
  readonly maxValueBytes?: number;
}
