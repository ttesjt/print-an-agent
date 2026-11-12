# Service provisioning boundary example

This is a non-Agent Composition example, not Memory/Agent business integration or a new exported API.

```text
Host owns Profile setup + Scope
  DocumentManagementDefinition.documents.resolveReader(tenant)
    → ProfileDocumentResourceService (Profile-specific Service holding Registry)
      → declared Reader Bundle Provider → declared Store Provider

DocumentTitleService → public DocumentManagementService.read
  → Definition resolver, on demand → native Bundle → neutral Workflow/Step → explicit DocumentReader
```

- `service.ts` defines a generic application entry and composes a second Service through its public
  read capability. It knows neither Registry nor a concrete Profile. Its Definition factory is called
  per operation, not at Service construction.
- `workflow.ts` defines neutral execution with explicit resources. Shared Bundle instances still
  produce independent Run state, signals and results.
- `profile.ts` fixes a logical-tenant → authority-binding map and a resource-resolution Service that
  legitimately holds Registry. Unknown tenants fail without creating a resource or falling back to a
  new authority. That Service has no Scope close method; only caller-owned setup does.
- The Bundle Provider explicitly declares Store, including the reference its release callback uses.
  The reverse dependency order is recorded, not inferred from a resolver closure.
- The same generic Service works with a direct factory and no Registry. Registry is optional
  provisioning machinery, not a mandatory Service/Workflow interface.

Host joins business operations before closing setup. Canceling a resolver waiter does not cancel
Scope-owned shared initialization; canceling a Run does not close the shared Store. The corresponding
tests are `../../service-provisioning.test.ts`; architectural checks reject Registry imports in
the generic Service/Workflow and allow them in Profile resource-resolution Services.

Run `pnpm --filter @print-an-agent/base-integration-tests exec vitest run test/resource-registry` or the full
root `pnpm test:base-composition-qualification`.
