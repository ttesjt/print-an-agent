# Print an Agent repository instructions

Start with the [documentation index](docs/README.md) to find the module that owns your task.
Read that module's guide and the relevant package contract before editing. Follow any scoped
`AGENTS.md` that applies to the paths you touch.

- For TypeScript changes, follow the [code standards](docs/standards/code-standards.md).
  For packages, imports, or tooling changes, also read the
  [monorepo standards](docs/standards/monorepo-standards.md) and the
  [workspace conventions](docs/development.md#workspace-conventions).
- Keep dependencies in the direction described in [Architecture](docs/architecture.md).
  Use declared public package exports across boundaries. Workflow and Step code receives explicit
  resources. Hosts and composition choose adapters and provider implementations.
- Use the pinned Node.js and pnpm toolchain, the shared root lockfile, and the manifest of the package
  that actually consumes each dependency.
- Choose checks using [Verification](docs/development.md#verification). Run focused checks for the
  affected packages and consumers. Check architecture when changing package boundaries. Use
  `pnpm validate` for full workspace verification and report which checks actually ran.
- Maintain one owner for each contract, and update its docs alongside changes to behavior or usage.
  Use the [documentation ownership guide](docs/README.md#documentation-ownership) when adding or
  moving a guide. Keep plans and progress records outside the repository's maintained documentation.
