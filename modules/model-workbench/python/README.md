# Model Workbench Python

Independent uv workspace for Python execution backends owned by Model Workbench. It will contain
training, conversion, qualification, and model-transform packages only when those capabilities
require Python.

Copy `template` into `packages/<name>` to create a package, then add its `src` and `tests` paths to
the workspace Mypy `files` list. Do not add Agent Base or application runtimes dependencies here.
