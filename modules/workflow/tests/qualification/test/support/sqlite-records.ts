import { DatabaseSync } from 'node:sqlite';
import type { CatalogRecord, RecordStore } from '../consumers/record-update.js';

/** Adapter owns CAS and durable side effects; Workflow only borrows the port. */
export class SqliteRecords implements RecordStore {
  readonly #database: DatabaseSync;
  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec(
      'CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, title TEXT NOT NULL)'
    );
  }
  seed(id: string, title: string): void {
    this.#database.prepare('INSERT INTO records VALUES (?, 1, ?)').run(id, title);
  }
  read(id: string, signal: AbortSignal): Promise<CatalogRecord> {
    signal.throwIfAborted();
    const row = this.#database.prepare('SELECT revision, title FROM records WHERE id = ?').get(id);
    if (row === undefined || typeof row.revision !== 'number' || typeof row.title !== 'string')
      throw new Error('Record missing or invalid.');
    return Promise.resolve({ revision: row.revision, title: row.title });
  }
  compareAndSwap(
    id: string,
    revision: number,
    title: string,
    signal: AbortSignal
  ): Promise<CatalogRecord> {
    signal.throwIfAborted();
    const updated = this.#database
      .prepare(
        'UPDATE records SET revision = revision + 1, title = ? WHERE id = ? AND revision = ?'
      )
      .run(title, id, revision);
    if (updated.changes !== 1) throw new Error('Revision conflict.');
    return Promise.resolve({ revision: revision + 1, title });
  }
  close(): void {
    this.#database.close();
  }
}
