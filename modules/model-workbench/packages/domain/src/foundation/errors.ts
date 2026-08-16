export class WorkbenchDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidWorkbenchValueError extends WorkbenchDomainError {
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string, options?: ErrorOptions) {
    super('WORKBENCH_VALUE_INVALID', `${path} ${reason}`, options);
    this.path = path;
    this.reason = reason;
  }
}
