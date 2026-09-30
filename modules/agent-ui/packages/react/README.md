# `@ta-agent/ui-react`

Unstyled React behavior and accessible component structure for Agent UI applications.

Components expose stable `ta-ui-*` global classes and `data-*` state hooks. They do not import CSS,
contain inline visual rules, or choose a theme. Applications can install `@ta-agent/ui-styles` or
provide their own stylesheet for the same hooks.

The package includes:

- semantic layout primitives (`Stack`, `Cluster`, and `Grid`), App Shell landmarks, and Panel
  sections;
- native action primitives (`Button`, `IconButton`, and `TextLink`) that keep command and navigation
  semantics distinct;
- native form controls plus a `FormField` render contract for label, description, and error
  relationships;
- feedback primitives whose visual tone remains independent from explicit live-region behavior.
- modal `Dialog`, modal `Drawer`, and `ConfirmationDialog` primitives with controlled open state,
  portal ownership, native modal focus containment, focus restore, explicit dismissal, and nested
  scroll-lock cleanup;
- local navigation primitives (`Tabs`, `Disclosure`, and `NavigationRail`) that own keyboard and
  ARIA behavior without owning routes or application selection.

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
`onToggle` is observational rather than a cancellation boundary. Navigation Rail is structural only
and does not infer a router, current route, or Agent/Session selection.
