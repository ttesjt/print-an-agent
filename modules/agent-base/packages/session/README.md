# `@ta-agent/base-session`

Generic session and turn state ports for Agent Base.

`MemorySessionAdapter` is the current standalone development profile. It is process-local and not a
durable production adapter. The core contract does not prescribe SQLite, files, Pi Session storage,
or a product database.
