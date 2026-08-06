# `@ta-agent/base-model`

Provider-independent model invocation and bounded Agent Loop contracts.

The package owns Provider Model References, normalized text messages, usage, execution targets,
streaming events, runtime ports, and structured failures. Provider SDK and Pi types are adapter
details and never appear in this public API.

The current message surface is deliberately text-only. Tool calls, images, and provider-specific
options will be added only with the bounded capability that needs them.
