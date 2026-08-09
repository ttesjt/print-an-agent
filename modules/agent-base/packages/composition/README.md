# `@ta-agent/base-composition`

The official Agent Base runtime composition root.

`composeAgent()` accepts Agent Base-owned Actor and Responsibility catalogs plus replaceable Session,
Request Journal, Tool, OutputSink, Workflow/Step, and observability ports. It constructs and returns
exactly one Agent owner with one Workflow Catalog and three public Operations: `foreground`,
`compactSession`, and `navigateSession`. The returned value is the actual `Agent`, not another
runtime facade, and requires a resolvable `main` Actor.

`createAgentAPI(agent)` is an optional transparent convenience projection. It exposes the wrapped
`agent` plus named `run()`, `compactSession()`, and `navigateSession()` methods. Correctness does not
depend on this layer: timeout mapping, input preparation, Session authority, and every other official
Operation behavior execute through raw `agent.invoke()`.

`createProviderAgentAPI()` is the ordinary-provider convenience factory. It accepts the closed
builtin or OpenAI-compatible provider profile, creates the required `main` Actor and built-in
Responsibilities, and retains the same replacement boundaries. Its `inspectProvider()` and
`checkProviderReadiness()` surfaces are metadata-only. Pi `0.82.1` remains the pinned internal
adapter; its name and types do not enter this package's public declarations.

`createDeterministicAgentAPI()` selects the reproducible offline development/test profile through
the same internal low-level loop boundary. It exposes `inspectDeterministicProvider()` for bounded
fixture evidence. Consumers needing multiple or custom Engines inject Agent Base-owned Actor and
Engine catalogs through `composeAgent()` directly and receive the raw Agent.

The runtime exposes:

- `run()` for the canonical Request Workflow and bounded provider/Tool loop;
- `compactSession()` for an explicit replaceable compaction Workflow;
- `navigateSession()` for inspect/select/fork/non-destructive rewind.

The optional Agent API also exposes immutable `operationNames` and `workflowNames` inspection views.
Each method call delegates directly to the wrapped Agent and creates a distinct Agent Run with its
Operation-specific input, output, Context, local resources, and trace lifecycle.

Memory Session, Request Journal, OutputSink, and no-op tracing remain zero-configuration development
defaults. Callers may inject SQLite or product-owned adapters without changing the composition root.
Completed replay returns the original response without another provider call, Tool call, or Session
turn. Tool access remains deny-by-omission across Responsibility, Actor, product, and runtime policy.

Standalone configuration and concrete persistence selection belong to
`@ta-agent/base-standalone-agent`. Agent directories, Identity lifecycle, managed Config persistence,
automatic compaction scheduling, advanced branch lifecycle, provider failover, and product UX are
not composition responsibilities.
