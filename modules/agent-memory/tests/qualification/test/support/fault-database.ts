import { DatabaseSync } from 'node:sqlite';

/** Faults only the connection boundary; the actual durable transaction still runs in SQLite. */
export class FaultDatabase extends DatabaseSync {
  loseCommitReply = false;
  disconnectAfterCommit = false;
  failRollback = false;
  afterCommit: (() => void) | undefined;
  override exec(sql: string): void {
    if (sql === 'ROLLBACK' && this.failRollback) throw new Error('Injected rollback failure.');
    super.exec(sql);
    if (sql !== 'COMMIT') return;
    this.afterCommit?.();
    if (this.disconnectAfterCommit) this.close();
    if (this.loseCommitReply) throw new Error('Injected lost COMMIT reply.');
  }
}
