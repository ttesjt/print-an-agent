# Invocation ownership

Messages, usage and execution provenance have one owner in Core. Provider references and credential
resolution describe callable models without model-training or application lifecycle semantics.

Completion returns a buffered assistant result. Interaction is a separate optional capability with
its own events and model-turn budget. A native Interaction Engine does not need a Completion method.
Model-facing tool schemas and call data are shared protocols; executable registries, permission
intersection, execution leases, inspection and disposal are consumer responsibilities.

Single-generation Streaming is its own optional capability, independent of buffered Completion and
multi-turn Interaction. Its events reuse the same delta and terminal message definitions. It owns
one ordered delivery queue, explicit output/reasoning budgets, and in-flight delivery drainage.
Terminal delivery waits for a matching normalized Engine result; once admitted, no further content
is accepted. The first observed failure remains authoritative even when an Engine catches it.

The Pi adapter shares its single-generation execution between buffered and streamed entry points.
The entry point explicitly selects delivery mode. A rejected callback cancels and joins the provider
producer; transport clocks pause during callback backpressure. Tool execution remains exclusive to
Interaction and its consumer-supplied tool port.

Invocation wrappers compose instructions, narrow capability declarations, propagate cancellation,
enforce owned deadlines and validate results. Interaction additionally validates its event/result
protocol and terminal consistency. On Engine success it drains accepted events before publishing the
terminal result. On Engine failure it closes admission; consumers own draining already-started
delivery before disposing their resources.

Adapters must not import Agent or product packages. A consumer supplies a minimal capability through
its ordinary dependency injection. No universal resource registry or invocation manager is required.
