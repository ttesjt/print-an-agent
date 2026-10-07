# Agent UI capability map

This map defines the intended reusable capability scope and the ownership split between Agent UI
packages and a concrete application. It is not a collection of public contracts. A capability gains
an exported contract only when implementation starts with a real consumer.

States:

- **Implemented**: available through the current public package surface.
- **Planned**: accepted reusable scope, not implemented yet.
- **Deferred**: evidence is insufficient or the capability is outside the current implementation
  sequence.

## Foundation primitives

| Capability               | Reusable UI responsibility                                       | Application responsibility                    | State       |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------- | ----------- |
| Panel                    | Semantic container, accessibility attributes, stable style hooks | Placement and content                         | Implemented |
| Stack, cluster, and grid | Layout structure and semantic hooks                              | Choose composition and responsive arrangement | Implemented |
| Application shell        | Persistent header/sidebar/main/inspector structure               | Routing, active view, and panel state         | Implemented |
| Button and icon button   | Native behavior, variants, disabled/pending semantics            | Action authority and pending state            | Implemented |
| Action bar               | Named, composable native control group and quiet style hooks     | Items, commands, and navigation authority     | Implemented |
| Form field and controls  | Label/error relationships, native input behavior, style hooks    | Validation rules, values, and submission      | Implemented |
| Status and feedback      | Loading, error, empty, notice, and badge presentation            | Produce safe messages and recovery actions    | Implemented |
| Data display             | Section, label/value, timestamp, and identifier presentation     | Select and normalize displayed data           | Implemented |
| Theme control            | Accessible native selection control                              | Persistence and initial preference policy     | Implemented |

## Overlay and navigation primitives

| Capability      | Reusable UI responsibility                                         | Application responsibility                   | State       |
| --------------- | ------------------------------------------------------------------ | -------------------------------------------- | ----------- |
| Dialog          | Native modal lifecycle, focus restore, Escape, portal, style hooks | Open state, content, and command execution   | Implemented |
| Confirmation    | Destructive/ordinary confirmation structure and pending state      | Copy, authority, and operation result        | Implemented |
| Modal Drawer    | Start/end modal panel lifecycle and style hooks                    | Visibility, breakpoint, and selected content | Implemented |
| Tabs            | Keyboard navigation and ARIA relationships                         | Active value and panel content               | Implemented |
| Disclosure      | Native expand/collapse behavior and state hooks                    | Content and persistence choice               | Implemented |
| Navigation Rail | Named navigation structure and semantic regions                    | Routes, records, and selection authority     | Implemented |
| Tooltip         | Hover/focus description, Escape, placement, and cleanup            | Safe informational content and trigger       | Implemented |
| Popover/menu    | Accessible transient interaction                                   | Actions and application policy               | Deferred    |

## Agent management

| Capability           | Reusable UI responsibility                                      | Application responsibility                                    | State       |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- | ----------- |
| Agent list           | List/empty/selected/working presentation and callbacks          | Catalog port, loading, refresh, and selection authority       | Implemented |
| Agent summary        | Identity, lifecycle, metadata, and safe diagnostic presentation | Map backend records into view models                          | Implemented |
| Agent creation       | Identity/config form shell and application-defined field slots  | Config schema, validation, defaults, and command adapter      | Implemented |
| Agent configuration  | Config sections, pending/error/conflict presentation            | Revision authority, codecs, and save command                  | Implemented |
| Display-name editing | Native field/form primitives; optional metadata port            | Immutable ID, CAS authority, validation and conflict recovery | Implemented |
| Disable/reactivate   | Lifecycle actions and confirmation presentation                 | Install lifecycle capability and reconcile authority          | Implemented |
| Hard deletion        | None; built-in lifecycle does not assume deletion               | Product-specific capability and UI                            | Deferred    |

## Session management

| Capability         | Reusable UI responsibility                                             | Application responsibility                           | State       |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------- | ----------- |
| Session list       | Active/retired records, empty/loading-more states, selection callbacks | Query ports, cursor ownership, and selected Session  | Implemented |
| Draft conversation | Distinguish an unsaved conversation from a persisted Session           | Draft identity and first-submit binding              | Implemented |
| Rename             | Form and pending/error presentation                                    | Command authority and reconciliation                 | Implemented |
| Retire/restore     | Lifecycle action presentation                                          | Install narrow capabilities and refresh authority    | Implemented |
| Purge              | Destructive confirmation and unavailable-capability behavior           | Explicitly install purge capability                  | Implemented |
| Branch/navigation  | Branch history, selection, and optional turn-level fork/rewind actions | Navigation and branch-mutation adapters              | Implemented |
| Compaction         | Status/action presentation                                             | Install compaction capability and expose safe status | Deferred    |

## Conversation and model activity

| Capability              | Reusable UI responsibility                               | Application responsibility                                       | State       |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- | ----------- |
| Transcript              | Ordered turns and empty/loading/failure states           | History query, pagination, and normalization                     | Implemented |
| User/assistant messages | Semantic message presentation and metadata slots         | Supply safe content and provenance projection                    | Implemented |
| Reasoning blocks        | Live/saved presentation with model-turn boundaries       | Stream events and persisted presentation records                 | Implemented |
| Composer                | Draft input, IME-safe submit, send/cancel controls       | Readiness, command execution, and cancellation                   | Implemented |
| Streaming state         | Ordered delta and terminal-state presentation            | Transport, validation, reconnect policy, and backpressure        | Implemented |
| Tool activity           | Tool call/result status and expandable safe details      | Normalize tool events and redact result data                     | Implemented |
| Conversation scrolling  | Follow-output and user-scroll preservation               | Conversation identity and content revisions                      | Implemented |
| Completed Turn actions  | Optional commands and hover/focus timestamp presentation | Completion authority, formatting, capabilities, and confirmation | Implemented |

## Application composition

| Capability              | Reusable UI responsibility                                     | Application responsibility                                   | State       |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | ----------- |
| Selection orchestration | Reusable logic only after demonstrated cross-application value | Agent/Session selection authority and routing                | Implemented |
| Concurrent interactions | Present independent lifecycle state                            | Scope operations, cancellation, and stale-result suppression | Implemented |
| Error projection        | Render stable UI-safe errors and recovery actions              | Map/redact backend and transport failures                    | Implemented |
| Backend adapter         | Define the narrow ports it must satisfy                        | Map public backend APIs into UI contracts                    | Implemented |
| Runtime validation      | Optional transport-neutral codecs when justified               | Validate every external transport boundary                   | Implemented |
| HTTP/stream transport   | None                                                           | Protocol, server, security, and credential policy            | Implemented |
| Host/filesystem setup   | Generic form primitives only                                   | Product/application-specific implementation                  | Deferred    |

Application capabilities marked Implemented live in Agent Web, not reusable packages. Tool
presentation is live-only at its current Agent Base boundary; persisted reasoning is restored
separately. Compaction remains deferred pending an explicit public authority/consumer. Agent ID is
immutable; display-name updates use the optional metadata capability with revision checks.
Remote authentication, durable stream reconnect
and deployment control are not claimed by this local application.
