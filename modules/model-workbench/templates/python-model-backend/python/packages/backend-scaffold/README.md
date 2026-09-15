# Model backend scaffold

Repository-local CLI and generation engine for creating a standalone Workbench-compatible Python
model backend from the maintained reference template.

From the repository root:

```console
pnpm scaffold:model-backend -- \
  --target /absolute/path/to/my-model \
  --project-name my-model
```

`--package-name` is optional and defaults to the project name with hyphens replaced by underscores.
The target is the final project directory and must not already exist. The command never overwrites a
directory, initializes Git, installs dependencies, accesses the network, or runs model training.

The scaffold engine owns safe copying, identity replacement, and structural validation. The
maintained model backend owns the curated copy roots and verification commands through
`model-backend.template.json`.
