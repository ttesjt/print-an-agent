# Python model backend template: Workbench definition

Workbench-side definition paired with the runnable Python reference backend in this template. The
factory returns ordinary static Workbench setup plus live Extension Runtime resources; it does not
create a second control plane.

```ts
const definition = createPythonModelBackendDefinition(
  {
    pythonExecutable: '/absolute/path/to/python',
    backendModule: 'my_model_backend',
    backendSourceDirectory: '/absolute/path/to/model-backend/src',
    rootDirectory: '/absolute/path/to/workbench-runtime',
    device: PythonModelBackendDevice.Cpu,
    dtype: PythonModelBackendDType.Float32,
  },
  { profiles: [{ profileId: 'profile.example' }] }
);

const workbench = createModelWorkbench(definition);
```

One Extension set and Runtime Binding are reused across every supplied Profile. Workbench still
isolates Runtime Support paths and persistence by `profileId`. Device and dtype default to CPU and
float32; a deployment may explicitly select CUDA or MPS when its Python environment supports it.

`backendModule` defaults to `ta_agent_model_backend`. Set it to the generated Python package name
when using a renamed standalone backend. The definition validates the dotted module name and uses
it for every initialization, training, export, and invocation command.

This private package is the model-specific Workbench half of the template, not generic Workbench
infrastructure. Changes to Capability input, result data, Artifact format, or invocation shape must
update this package and the corresponding Python composition together. The backend's
[`customization guide`](../python/packages/model-backend/docs/customizing.md) identifies each paired
boundary.
