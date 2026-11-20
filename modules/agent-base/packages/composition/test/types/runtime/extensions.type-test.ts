import { composeAgentWithExtensions, type ComposeAgentOptions } from '../../../src/index.js';

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

export function verifyStandardOperationResourceTypes(options: ComposeAgentOptions): void {
  const agent = composeAgentWithExtensions(options, () => ({
    resources: { product: 'value' as const },
    operations: {},
  }));
  const product: 'value' = agent.resources.product;
  void product;
  // @ts-expect-error Extracted operation factories preserve the typed standard resource map.
  void agent.resources.unknownResource;
  // @ts-expect-error Extensions preserve exact standard Operation names.
  void agent.invoke('unknownOperation', {});
}
