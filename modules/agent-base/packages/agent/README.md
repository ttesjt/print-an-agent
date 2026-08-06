# `@ta-agent/base-agent`

The official assembled Agent Base composition root.

`assembleAgentBase()` accepts Agent Base-owned runtime and adapter ports. `createPiFauxAgentBase()`
selects the current offline development profile: Pi's low-level loop, a deterministic faux provider,
in-memory sessions, the canonical request Workflow, and a memory OutputSink default.

The composition structure is the supported production architecture. Its current memory/faux profile
is intentionally not a durable or remote-provider production profile.
