# `@ta-agent/base-standalone-agent`

The official standalone reference Agent application boundary.

`defineStandaloneAgentConfig()` decodes one closed `schemaVersion: 1` JSON-compatible value.
`createStandaloneAgent()` selects the ordinary provider-backed `AgentAPI` plus an explicit Memory or
absolute-path SQLite persistence profile. The API is a transparent delivery convenience and exposes
its underlying composed `Agent`. SQLite composes both Session and Request Journal adapters over the
supplied database. Credential references bind only to a named environment reader; API keys never
belong in configuration.

This package depends on `@ta-agent/base-composition` and official concrete adapters. It does not
import or expose the internal Pi adapter. Agent directory creation, Identity catalog/lifecycle,
portable manifests, and managed Config persistence are intentionally deferred to the next bounded
slice.
