import { composeAgentWithExtensions, type ComposeAgentOptions } from '../../src/index.js';

export function verifyCompositionExtensionConflicts(options: ComposeAgentOptions): void {
  composeAgentWithExtensions(options, () => ({
    // @ts-expect-error Standard resource names cannot be replaced by an extension.
    resources: { session: 'replacement' },
    operations: {},
  }));

  composeAgentWithExtensions(options, (standard) => ({
    resources: {},
    // @ts-expect-error Standard Operation names cannot be replaced by an extension.
    operations: { foreground: standard.operations.foreground },
  }));
}
