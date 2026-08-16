export const WorkbenchSetupKind = {
  Resolved: 'resolved-workbench-setup',
} as const;

export type WorkbenchSetupKind = (typeof WorkbenchSetupKind)[keyof typeof WorkbenchSetupKind];

export const RuntimeBindingKind = {
  Binding: 'runtime-binding',
} as const;

export type RuntimeBindingKind = (typeof RuntimeBindingKind)[keyof typeof RuntimeBindingKind];
