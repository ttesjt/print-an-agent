export class WorkbenchSetupError extends Error {
  readonly code = 'WORKBENCH_SETUP_INVALID';
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string, options?: ErrorOptions) {
    super(`${path} ${reason}`, options);
    this.name = 'WorkbenchSetupError';
    this.path = path;
    this.reason = reason;
  }
}
