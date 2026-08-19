export class WorkbenchPersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class PersistenceRecordConflictError extends WorkbenchPersistenceError {
  constructor(kind: 'run' | 'base' | 'modification', identity: string) {
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
