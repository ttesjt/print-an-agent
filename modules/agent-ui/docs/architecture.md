# Agent UI architecture

## Dependency direction

Reusable Agent UI packages are independent of Agent Base, Model Workbench, and application runtimes.
They express the UI capabilities they consume through module-owned ports. A concrete application
implements those ports at its composition boundary.

```text
ui-contracts ──────┬── ui-react
                   └── agent-web
ui-react ──────────┬── agent-web
                   └── component-gallery
ui-styles ─────────┬── agent-web
                   └── component-gallery
```

`agent-web` owns its Node-side Agent Base backend adapter. That integration does not grant reusable UI
packages permission to import Agent Base runtime types. `component-gallery` uses only public package
exports and deterministic examples; it does not connect to Agent Base or another domain runtime.

## Style contract

React components own DOM structure, behavior, state, accessibility, and stable semantic class or
`data-*` hooks. They do not own visual rules, import component-local CSS, use inline styles, or load
the optional default stylesheet.

The default stylesheet is exported independently by `@ta-agent/ui-styles`. It uses prefixed CSS
custom properties, low-specificity semantic classes, and ordered cascade layers. Consumers can
import it unchanged, override it after import, or replace it entirely while retaining component
behavior.

Application composition may choose a stylesheet. Reusable components never make that choice for the
application.

The public stylesheet layers are ordered as `tokens -> base -> layout -> components`. Theme modes
are selected with `data-ta-ui-theme="light|dark|system"`; applications own preference persistence
and initial policy. Nested theme boundaries rebind inherited foreground color but do not implicitly
paint a new canvas. Layout components expose bounded semantic variants rather than arbitrary CSS
values. App Shell derives optional sidebar and inspector columns from the regions actually present.

## Package roles

`@ta-agent/ui-contracts` owns framework-neutral, browser-safe view models and narrow ports. It must
not depend on React, a state manager, another Agent UI package, or a domain runtime.

`@ta-agent/ui-react` may consume `@ta-agent/ui-contracts`, React, and ReactDOM for explicit browser
portal ownership. It owns reusable DOM structure, interaction behavior, accessibility, and local
presentation state. It must not depend on the styles package, an application store, a transport
client, or a product package.

`@ta-agent/ui-styles` implements the semantic style hooks. It does not own behavior or import the
React and contracts packages.

Applications own routing, transport, backend adapters, credentials, persistence choices, and
application-wide state orchestration. Reusable packages do not reach into an application through
relative imports or global service locators.

Agent Web groups the narrow public UI ports it consumes at its application composition boundary.
This structural grouping is not a new universal adapter contract: controllers still depend on
capability-specific methods, and another application may group or implement the ports differently.
Persisted conversation state is owned by a stable Agent/Session/branch key rather than by current
selection. Selection is a view projection; it does not cancel work owned by another persisted
target. Unpersisted drafts are the deliberate exception because they have no navigable Session
identity and remain foreground-owned until a successful interaction creates one.

## Application roles

`apps/` contains independently startable, buildable, or deployable composition roots.

`@ta-agent/ui-agent-web` is the general-purpose Agent Web application. It owns the
Agent runtime adapter, lifecycle and Session orchestration, conversation transport, routing, and
application-wide state.

`@ta-agent/ui-component-gallery` is a developer visual-qualification application. It displays the
public components, bounded variants, themes, responsive behavior, accessibility, and semantic DOM.
It does not connect a backend, hold formal business state, or implement reusable components.

Application-specific behavior must not flow back into `packages/`. The Gallery imports components
only through public package exports and may use namespaced application CSS only to arrange and label
examples; it must not patch reusable `ta-ui-*` component hooks.

## Ports and view models

UI contracts describe only the information and actions required by a browser-facing capability.
They do not re-export backend DTOs or mirror an entire domain object. An application adapter maps a
backend's public API into these contracts.

Contracts follow these rules:

- queries, commands, and streams remain distinct operations;
- asynchronous operations accept a standard optional `AbortSignal` at the call boundary;
- cancellation is cooperative and does not imply that every backend side effect is reversible;
- revisions, cursors, terminal states, and other concurrency semantics are retained when the UI
  needs them;
- untrusted transport data is validated by the application adapter before it reaches a UI port;
- public errors contain a stable code, safe user-facing message, and only explicitly projected
  details;
- optional features are installed as explicit, narrow capabilities rather than discovered by
  probing arbitrary objects or through a universal service registry.

Exact feature contracts are introduced with their first real consumer. The contracts package does
not accumulate speculative Agent, Session, or conversation schemas ahead of implementation.

Conversation history and interaction streams are browser presentation contracts, not copies of an
Actor Engine or provider protocol. The application adapter is responsible for validating external
events, preserving their order, applying backpressure, and projecting them into safe text,
model-turn reasoning blocks, and tool activity. Tool presentation contains only adapter-approved
labels, summaries, and display details; raw arguments, results, traces, credentials, and provider
payloads are outside the UI contract.

A successful terminal interaction contains the canonical completed Turn and must agree with the
presentation events already accepted by the application. Failed or cancelled partial output may
remain visible in the current application view with an explicit incomplete state, but is not
silently promoted to a completed history Turn. Conversation components render these projections;
they do not invoke ports or become the history authority. History loading or failure is a boundary
state beside visible live/partial Turns, not a replacement for them. A tool still reported as
pending when its parent interaction fails or is cancelled is presented as interrupted; this derived
UI state does not rewrite or invent a backend tool-lifecycle event.

The current reusable capability scope and ownership map is maintained in
[capability-map.md](./capability-map.md). The map plans capability ownership; it does not create a
public contract before implementation begins.

## Component ownership

Reusable components receive data, state, callbacks, and optional slots through props. They do not
import an application store or call a backend client directly. Components may own interaction-local
state such as focus, disclosure, draft input, or composition state; backend authority and
application selection remain outside the component.

Stable style hooks use these conventions:

- component root: `ta-ui-<component>`;
- component part: `ta-ui-<component>__<part>`;
- state and variants: descriptive `data-*` attributes;
- consumer additions: `className` composed with the stable hook.

Reusable components intentionally do not expose inline visual policy. Consumers customize the
provided hooks and tokens instead.

Interactive primitives preserve native element semantics. Commands use buttons, navigation uses
anchors, and form controls retain native controlled or uncontrolled state. Form composition may
provide IDs and ARIA relationships but does not own validation rules, field values, or submission.
Visual feedback tone does not imply live-region behavior; only the application knows whether a
message is initial content or a newly produced announcement.

Action bars preserve native Tab navigation as named groups rather than introducing toolbar/menu
keyboard semantics. Tooltips own transient informational presentation only; applications own
commands. `ConversationTurnActions` is a public convenience composition, not a second Turn owner:
the application determines successful completion, provides copy/formatters, and confirms mutations.
Agent Web exposes this bar only after the complete interaction port invocation settles successfully.
Popover/anchor positioning belongs to the optional global stylesheet, not inline component styling
or a dependency on an external overlay framework.

Responsive layout preserves consumer-authored DOM order as the reading, keyboard-focus, and
screen-reader order. Default CSS may reflow regions into different grid shapes but does not use
`order` or `display: none` to rearrange or hide semantic regions. Drawer, disclosure, and mobile
panel switching are explicit interaction capabilities, not implicit breakpoint behavior.

The public Drawer is a modal overlay with controlled visibility. Persistent desktop sidebar and
inspector regions remain part of App Shell. Applications choose when a narrow layout opens a Drawer;
the reusable packages do not install a breakpoint observer, duplicate semantic content, or hide an
App Shell region automatically.

Because modal overlays portal to `document.body` by default, `.ta-ui-modal-surface` is an explicit
base-style root alongside `.ta-ui-root`. Portal placement may change DOM ancestry, but it must not
silently remove box sizing, inherited control typography, focus, or accessibility-oriented visual
defaults.

## Lifecycle boundaries

The built-in Agent lifecycle capability presents disable/reactivate and does not assume hard
deletion. Session purge may be presented only when an application explicitly supplies that
capability; its absence must not be treated as an error or inferred from another Session operation.
Turn-level fork and rewind are likewise optional capabilities. Their default semantics are
non-destructive branch creation guarded by the Session navigation revision; they do not delete or
rewrite existing history.

# Collection boundary

Collection references are safe application-defined JSON, not a framework storage-kind enum.
Opening and routing bind existing narrow domain ports to an application-owned connection. Reusable
selection components know neither filesystem paths nor Agent Base. Recent-history persistence is
an independent optional port; it does not own resources or active selection. Concrete directory,
HTTP and browser-storage implementations remain inside Agent Web's application composition.
