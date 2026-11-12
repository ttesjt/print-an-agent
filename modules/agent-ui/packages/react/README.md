# `@print-an-agent/ui-react`

Unstyled React behavior and accessible component structure for Agent UI applications.

Components expose stable `ta-ui-*` global classes and `data-*` state hooks. They do not import CSS,
contain inline visual rules, or choose a theme. Applications can install `@print-an-agent/ui-styles` or
provide their own stylesheet for the same hooks.

The package includes:

- semantic layout primitives (`Stack`, `Cluster`, and `Grid`), App Shell landmarks, and Panel
  sections;
- native action primitives (`Button`, `IconButton`, and `TextLink`) that keep command and navigation
  semantics distinct;
- composable `ActionBar` groups, informational `Tooltip`, and ready-made `ConversationTurnActions`;
- native form controls plus a `FormField` render contract for label, description, and error
  relationships;
- feedback primitives whose visual tone remains independent from explicit live-region behavior.
- modal `Dialog`, modal `Drawer`, and `ConfirmationDialog` primitives with controlled open state,
  portal ownership, native modal focus containment, focus restore, explicit dismissal, and nested
  scroll-lock cleanup;
- local navigation primitives (`Tabs`, `Disclosure`, and `NavigationRail`) that own keyboard and
  ARIA behavior without owning routes or application selection.
- controlled Agent catalog, details, create/configuration forms, and explicit lifecycle capability
  presentation built on browser-safe UI contracts.
- controlled Session catalog, details, rename/lifecycle confirmations, and branch-selection
  presentation built on narrow browser-safe Session contracts.
- Conversation timeline, user/assistant messages, model-turn reasoning disclosures, sanitized tool
  activity, IME-safe Composer controls, and user-scroll-preserving live output.

Components preserve native props, events, browser state, and React 19 refs. They do not install a
form library, validation authority, icon set, router, or application state. `Button` pending state
prevents duplicate activation; `IconButton` requires an accessible name. `FormField` supplies
control attributes to its child render function without cloning elements or owning field values.

Layout and presentation props select bounded semantic variants; arbitrary visual values remain the
responsibility of consumer classes and stylesheets.

App Shell sidebar and inspector regions are optional. The default stylesheet derives its desktop
columns from the regions actually present; consumers do not maintain duplicate region flags.

Responsive layout never changes component DOM order or hides semantic regions. Applications that
need drawers, collapsible navigation, or conditional panels must install those behaviors
explicitly.

Visual tone such as `critical` does not automatically create a live region. `Alert`, `Status`, and
`InlineError` announce only when their `announcement` prop explicitly requests polite or assertive
behavior. A labelled `Spinner` is an accessible, non-live progress indicator by default and uses the
same explicit `announcement` choice when an application owns a newly produced loading state. This
prevents initial static content from being announced as a new event.

`Dialog` and `Drawer` use the browser's native modal `<dialog>` behavior. `Drawer` is always a modal
overlay; persistent sidebar and inspector regions remain `AppShell` responsibilities. Overlays
portal to `document.body` by default. Applications that scope theme tokens below the document root
should pass a `portalContainer` inside that theme boundary. Open state and application commands stay
controlled by the consumer; Escape, outside interaction, and confirmation cancel actions report an
explicit close reason. Native closure through `form method="dialog"` or an imperative ref reports
`native-close`; when the controlled owner declines that request, or dismissal is disabled, the
component restores the modal. The native `onClose` prop observes native-originated closure only;
owner-driven reconciliation remains represented by the controlled `open` contract.

Tabs support controlled or uncontrolled selection, automatic or manual activation, horizontal or
vertical orientation, disabled tabs, and RTL-aware keyboard movement. Selection and roving focus
remain distinct in manual mode. If a controlled selection is missing or disabled, the first enabled
tab remains keyboard reachable without changing the application-owned selected value. Disclosure
uses native `details`/`summary` behavior and supports controlled or uncontrolled open state;
`appearance="plain"` is an explicit low-emphasis presentation; the default `surface` remains suitable
for bounded content. `onToggle` is observational rather than a cancellation boundary. Navigation Rail is structural only
and does not infer a router, current route, or Agent/Session selection.

An uncontrolled Disclosure may opt into caller-owned activity with
`activity={{ active, autoExpand: true, autoCollapse: true }}`. Both flags default to false. Expansion
is requested once when an activity starts, including mounting with an active activity. Collapse is
limited to content automatically opened by that activity; initially open content is not closed.
Manual summary activation takes over for the rest of that activity. A later activity starts a fresh
cycle. Native `toggle` generated by automatic rendering is not a manual action. `onToggle` remains
observational, while cancellation of summary activation belongs to `onClick`/`onClickCapture`.
Controlled `open` cannot be combined with internal activity policy; its owner remains authoritative.

Automatic collapse is deferred while focus is inside the content and applied when focus leaves it,
unless the reader takes over or another activity begins. Focus is never moved by automation.
`DisclosurePanel` accepts optional `contentMaxHeight="small" | "medium" | "large"`. Bounded panels
require `aria-label` or `aria-labelledby` and default to a keyboard-reachable scroll region. An absent
limit preserves natural height without an extra scroll region. Heights belong to global tokens,
not inline styles or component-local CSS.

Agent components never call ports directly. Applications own loading, selection, mutation,
reconciliation, and cancellation, then pass view models, presentation states, and callbacks into
the components. `AgentCreateDialog` owns only form structure; application-specific configuration
fields enter through a slot. `AgentConfigForm` presents dirty, pending, invalid, error, and revision
conflict states without parsing a configuration payload or choosing a merge policy. Disable and
reactivate actions appear only when the corresponding callback capability is installed. Hard
deletion is not part of the built-in lifecycle.

Lifecycle status values remain machine-readable state only. Applications provide the visible status
labels, and `AgentDetailsView` delegates timestamp formatting to its caller, so reusable components
do not establish product copy, locale, or timezone policy.

Session components follow the same ownership boundary: they never invoke Session ports, own cursor
pagination, or infer lifecycle/navigation authority. Applications supply localized labels,
timestamp/metadata formatters, current selection, working state, and only the action callbacks that
are actually installed. Purge is therefore visible only when an application provides that optional
capability. Applications can use `SessionListItem` without a confirmed `session` for an optimistic
row, without inventing lifecycle data or a durable ID. A new-conversation draft remains application
state until the host confirms its Session identity; this does not require model completion.
A working Session item cannot restart its own selection. Branch
selection is single-flight: the selected branch is not actionable, and all branch actions are
disabled while one selection is pending.

Conversation components remain port-free controlled presentation. The application supplies ordered
history and live state, cancellation, pagination, and optional turn actions. Reasoning remains
separate from assistant text and retains one block per model turn. Tool details are assumed to be an
already sanitized browser projection. A pending tool in a failed or cancelled parent Turn is
presented as interrupted without changing its source lifecycle value. Timeline loading and failure
feedback remains visible alongside any live or partial Turns. Composer submits Enter, preserves
Shift+Enter and IME composition, and exposes cancellation only while an interaction is active. The
scroll region follows new output only while the reader remains near the end; otherwise it preserves
position and exposes an explicit jump-to-latest command.

`ActionBar` is a named native control group, not an ARIA toolbar or menu. Each command/link retains
normal Tab navigation. It accepts consumer-authored items rather than a second action schema.
`Tooltip` decorates one focusable trigger through a render contract, without cloning it:

```tsx
<Tooltip content="Inspect the timestamps" placement="top">
  {(triggerProps) => (
    <IconButton {...triggerProps} aria-label="Message timestamps">
      …
    </IconButton>
  )}
</Tooltip>
```

Tooltips contain informational content only, never links or commands. Hover opens after 300ms;
focus opens immediately. Leaving both trigger/content and focus closes after 120ms, allowing the
pointer to cross the gap. Both delays are configurable. Escape dismisses without moving focus or
reopening in place; timers and document listeners are cleaned on dismissal/unmount. `describedBy`
preserves a consumer's existing accessible-description relationship. Touch does not synthesize
hover; the native focusable trigger remains available. Placement supports top/right/bottom/left.
Where native Popover and scoped CSS anchors are supported, the default styles use the top layer
without portalling or inline coordinates. Older browsers retain local positioning, which can be
clipped by ancestor overflow. Custom styles must implement the same positioning hooks.

`ConversationTurnActions` composes optional Fork/Rewind commands and a timestamps tooltip. The
caller supplies all copy, timestamp formatting, capabilities, and pending state. It does not invoke
ports, infer completion, or own confirmation. Applications should install it only after an
authoritative successful Turn; receiving a provisional stream completion is insufficient.

`ConversationTurn` is a logical grouping, not an exchange card. User and assistant messages follow
one another in reading order. Compact messages are the default: the speaker label remains available
to assistive technology while visible metadata is delegated to an application-owned details surface.
`presentation="detailed"` on a message or `messagePresentation="detailed"` on a Turn restores explicit
headers and caller-formatted timestamps. The default stylesheet uses a quiet user bubble and unframed
assistant text; successful turns omit a redundant completion banner, while working/failed/cancelled
states remain visible. Optional turn actions follow the response.

Reasoning and tool details use plain disclosures. Reasoning starts collapsed, including during
streaming, unless `defaultOpen`, controlled `open` or an explicit activity policy requests otherwise. Reader expansion survives content/state
updates. The reasoning label callback receives the model-turn index, readable block count and
presentation state, allowing single-block labels without technical numbering while preserving
multi-turn boundaries. Applications can use `null` for redundant completed state labels. Tool error
and interruption feedback remains prominent; routine pending/success feedback is low-emphasis text.
Presentation never changes reasoning retention, execution state or tool lifecycle authority.
ReasoningBlock accepts the same Disclosure state contract and optional `contentMaxHeight`; it never
infers activity start/end from reasoning text, provider behavior or its presentation `state`.
`ConversationTurn.reasoningDisclosure` allows an application to supply per-block controlled state
or explicit activity policy, and `reasoningMaxContentHeight` selects a common panel limit. Loading
completed history does not start an activity. Applications that replace a live Turn with canonical
history must retain expansion by logical block identity rather than relying on a remounted default.
