import type { SessionReference } from '../contracts/index.js';
import type { SessionInspection } from '../query/index.js';

export interface RenameSessionInput extends SessionReference {
  readonly title: string;
  readonly expectedRevision: number;
}

export interface SessionMetadataPort {
  renameSession(input: RenameSessionInput): Promise<SessionInspection>;
}
