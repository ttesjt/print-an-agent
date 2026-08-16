export class WorkbenchExtensionError extends Error {
  readonly code = 'WORKBENCH_EXTENSION_INVALID';
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string, options?: ErrorOptions) {
    super(`${path} ${reason}`, options);
    this.name = 'WorkbenchExtensionError';
    this.path = path;
    this.reason = reason;
  }
}
