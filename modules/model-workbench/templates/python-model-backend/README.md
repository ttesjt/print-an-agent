# Python model backend template

Maintained, runnable example of a model backend integrated through Model Workbench.

- `workbench-adapter/` owns the private TypeScript adapter: capability contracts, Profile setup,
  local Runtime Supports, and command construction.
- `python/` owns the matching Python workspace: the runnable reference backend, its scaffold, and
  Python qualification tests.

The two sides form one template and must evolve together. Neither directory is generic Workbench
infrastructure, and production consumers are expected to supply their own concrete backend
definition.
