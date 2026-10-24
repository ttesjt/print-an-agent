import { DatabaseSync } from 'node:sqlite';
import { isMainThread } from 'node:worker_threads';

// Isolated child-process preload: production workers inherit --import without any testing port.
if (!isMainThread) {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Rebound with exec.call(this, sql) below.
  const exec = DatabaseSync.prototype.exec;
  const failed = new WeakSet<DatabaseSync>();
  DatabaseSync.prototype.exec = function (sql: string) {
    if (sql === 'COMMIT' && !failed.has(this)) {
      failed.add(this);
      throw new Error('injected COMMIT before execution');
    }
    if (sql === 'ROLLBACK' && failed.has(this) && process.env.RETRIEVAL_TEST_DOUBLE_FAULT === '1')
      throw new Error('injected ROLLBACK failure');
    return exec.call(this, sql);
  };
  if (process.env.RETRIEVAL_TEST_CLOSE_FAULT === '1') {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Rebound with close.call(this) below.
    const close = DatabaseSync.prototype.close;
    DatabaseSync.prototype.close = function () {
      close.call(this);
      throw new Error('injected close failure after release');
    };
  }
}
