import type { DocumentBundle, DocumentReadResult } from './workflow.js';

export interface DocumentCallOptions {
  readonly signal?: AbortSignal;
}
export interface DocumentTarget {
  readonly tenant: string;
  readonly documentId: string;
}

/** Example-local Definition: a narrow provisioning seam, not another framework API. */
export interface DocumentManagementDefinition {
  readonly documents: {
    resolveReader(tenant: string, options?: DocumentCallOptions): Promise<DocumentBundle>;
  };
}
export interface DocumentManagementService {
  read(input: DocumentTarget, options?: DocumentCallOptions): Promise<DocumentReadResult>;
}

/** Application entry/coordinator. Creation is zero-I/O; only an operation requests resources. */
export function createDocumentManagementService(
  definition: DocumentManagementDefinition
): DocumentManagementService {
  return Object.freeze({
    async read(input: DocumentTarget, options: DocumentCallOptions = {}) {
      if (input.tenant.trim() === '' || input.documentId.trim() === '')
        throw new Error('Tenant and document ID are required.');
      options.signal?.throwIfAborted();
      const bundle = await definition.documents.resolveReader(input.tenant, options);
      options.signal?.throwIfAborted();
      return bundle.workflows.read.run({ input: { documentId: input.documentId }, ...options });
    },
  });
}

/** Explicit Service composition through public capability, never the first Service's adapter. */
export function createDocumentTitleService(reader: Pick<DocumentManagementService, 'read'>) {
  return Object.freeze({
    async title(input: DocumentTarget, options?: DocumentCallOptions) {
      const result = await reader.read(input, options);
      return result.text.split('\n')[0] ?? '';
    },
  });
}
