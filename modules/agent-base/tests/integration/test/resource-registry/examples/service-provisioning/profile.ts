import {
  ResourceToken,
  bindResourceScope,
  compileResourceBlueprint,
  createResourceScope,
  defineResourceProvider,
  resourceDependency,
  type ResourceAcquisition,
  type ResourceCloseOptions,
  type ResourceRegistry,
} from '@print-an-agent/base-composition/resource-registry';
import { WorkflowBundle } from '@print-an-agent/workflow-bundle';
import { createDocumentBundle, type DocumentBundle, type DocumentReader } from './workflow.js';
import type { DocumentCallOptions, DocumentManagementDefinition } from './service.js';

function tenantBinding(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('Tenant is required.');
  return input;
}

/** Resolves logical tenants to this Profile's declared authority bindings, without Scope ownership. */
class ProfileDocumentResourceService {
  constructor(
    private readonly registry: ResourceRegistry,
    private readonly reader: ResourceToken<string, DocumentBundle>,
    private readonly tenantBindings: ReadonlyMap<string, string>
  ) {}

  resolveReader(tenant: string, options?: DocumentCallOptions): Promise<DocumentBundle> {
    const binding = this.tenantBindings.get(tenant);
    if (binding === undefined) throw new Error('Unknown tenant.');
    return this.registry.resolve(this.reader.request(binding), options);
  }
}

export interface DocumentProfileRecipe {
  /** Logical target to concrete authority identity; fixed by the Profile, never by a business call. */
  readonly tenantBindings: ReadonlyMap<string, string>;
  readonly acquireStore: (
    tenant: string,
    signal: AbortSignal
  ) => ResourceAcquisition<DocumentReader> | Promise<ResourceAcquisition<DocumentReader>>;
  /** Demonstrates a dependent's release still using its declared Store dependency. */
  readonly releaseReader?: (store: DocumentReader) => void | Promise<void>;
}

/** Canonical example Profile: fixed recipe, explicit setup owner, no business Run at assembly. */
export function createDocumentProfile(recipe: DocumentProfileRecipe) {
  const { acquireStore, releaseReader } = recipe;
  const tenantBindings = new Map(
    [...recipe.tenantBindings].map(([tenant, binding]) => [
      tenantBinding(tenant),
      tenantBinding(binding),
    ])
  );
  const store = new ResourceToken('documents.store', {
    parseBinding: tenantBinding,
    isValue: (value: unknown): value is DocumentReader =>
      value !== null &&
      typeof value === 'object' &&
      'read' in value &&
      typeof value.read === 'function',
  });
  const reader = new ResourceToken('documents.reader', {
    parseBinding: tenantBinding,
    isValue: (value: unknown): value is DocumentBundle =>
      value instanceof WorkflowBundle && typeof value.workflows.read?.run === 'function',
  });
  const describe = (tenant: string) => ({ key: tenant, descriptor: { tenant } });
  const blueprint = compileResourceBlueprint([
    defineResourceProvider({
      token: store,
      dependencies: {},
      describe,
      create: ({ binding, signal }) => acquireStore(binding, signal),
    }),
    defineResourceProvider({
      token: reader,
      describe,
      dependencies: { store: resourceDependency(store, (tenant: string) => tenant) },
      create: ({ dependencies }) => ({
        value: createDocumentBundle({ documents: dependencies.store }),
        // Not an invisible resolver closure: the retained Store is a declared graph edge.
        release: () => releaseReader?.(dependencies.store),
      }),
    }),
  ]);
  const scope = createResourceScope(blueprint);
  const resources = new ProfileDocumentResourceService(
    bindResourceScope(blueprint, scope),
    reader,
    tenantBindings
  );
  const definition: DocumentManagementDefinition = Object.freeze({
    documents: Object.freeze({
      resolveReader: (tenant: string, options?: DocumentCallOptions) =>
        resources.resolveReader(tenant, options),
    }),
  });
  return Object.freeze({
    definition,
    resources,
    // Only the caller-owned setup exposes ownership; neither Service above has Scope.close().
    close: (options?: ResourceCloseOptions) => scope.close(options),
  });
}
