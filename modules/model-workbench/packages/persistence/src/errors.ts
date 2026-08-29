export class WorkbenchPersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class PersistenceRecordConflictError extends WorkbenchPersistenceError {
  constructor(kind: 'run' | 'base' | 'modification' | 'output', identity: string) {
    super(
      'PERSISTENCE_RECORD_CONFLICT',
      `The ${kind} record "${identity}" already exists with a conflicting value.`
    );
  }
}

export class RunTransitionPersistenceError extends WorkbenchPersistenceError {
  constructor(runId: string, reason: string) {
    super('RUN_TRANSITION_PERSISTENCE_INVALID', `Run "${runId}" ${reason}`);
  }
}

export class PersistenceProfileScopeError extends WorkbenchPersistenceError {
  constructor(
    recordKind: string,
    identity: string,
    expectedProfileId: string,
    actualProfileId: string
  ) {
    super(
      'PERSISTENCE_PROFILE_SCOPE_MISMATCH',
      `The ${recordKind} record "${identity}" belongs to Profile "${actualProfileId}", not persistence scope "${expectedProfileId}".`
    );
  }
}

export class PersistenceDataCorruptionError extends WorkbenchPersistenceError {
  constructor(recordKind: string, identity: string, options?: ErrorOptions) {
    super(
      'PERSISTENCE_DATA_CORRUPT',
      `The stored ${recordKind} record "${identity}" is malformed or inconsistent.`,
      options
    );
  }
}

export class SqlitePersistenceError extends WorkbenchPersistenceError {
  constructor(message: string, options?: ErrorOptions) {
    super('SQLITE_PERSISTENCE_FAILED', message, options);
  }
}
