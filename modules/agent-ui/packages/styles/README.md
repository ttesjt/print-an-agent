# `@ta-agent/ui-styles`

Optional default visual system for the semantic hooks published by `@ta-agent/ui-react`.

Import the complete default:

```ts
import '@ta-agent/ui-styles/default.css';
```

The package can be omitted. Consumers may instead implement the `ta-ui-*` classes themselves, or
import the default and override its prefixed custom properties and low-specificity selectors.

Individual layers are also public:

```ts
import '@ta-agent/ui-styles/tokens.css';
import '@ta-agent/ui-styles/base.css';
import '@ta-agent/ui-styles/layout.css';
import '@ta-agent/ui-styles/components.css';
import '@ta-agent/ui-styles/actions.css';
import '@ta-agent/ui-styles/action-bar.css';
import '@ta-agent/ui-styles/tooltip.css';
import '@ta-agent/ui-styles/forms.css';
import '@ta-agent/ui-styles/feedback.css';
import '@ta-agent/ui-styles/overlays.css';
import '@ta-agent/ui-styles/navigation.css';
import '@ta-agent/ui-styles/agent-management.css';
import '@ta-agent/ui-styles/session-management.css';
import '@ta-agent/ui-styles/conversation.css';
```

Set `data-ta-ui-theme="light"`, `"dark"`, or `"system"` on the document root or an embedded theme
boundary. An absent value uses the light tokens. Theme preference persistence belongs to the
application; this package only implements the visual modes. An embedded boundary rebinds inherited
foreground color but remains background-transparent; consumers choose whether that token scope is
also a complete canvas region.

`.ta-ui-modal-surface` is a second base-style root so the default body portal keeps box sizing,
typography, form-control inheritance, text resets, focus treatment, reduced motion, and forced-color
behavior even when it is no longer a descendant of `.ta-ui-root`.

The default cascade order is `tokens -> base -> layout -> components`. Actions, forms, feedback,
overlays, navigation, Agent management, Session management, conversation presentation, and the
general component stylesheet all occupy the public components layer.
Consumer styles loaded afterward can override semantic hooks or any `--ta-ui-*` token without
changing component behavior.

Conversation defaults prioritize reading: neutral user bubbles, unframed assistant text, plain
auxiliary disclosures, and a bounded reading column shared by the transcript and Composer. The
`--ta-ui-size-conversation-content-max`, `--ta-ui-size-conversation-response-max`, and
`--ta-ui-font-size-conversation-title` tokens tune that hierarchy globally. `ta-ui-conversation-heading`
is the matching page-heading hook. Compact speaker labels use the public `ta-ui-visually-hidden`
base utility; they are not removed from the accessibility tree. Plain disclosures keep native
summary markers, keyboard behavior and focus treatment without introducing borders or surfaces.

Disclosure content is unbounded unless a height limit is selected. `data-content-max-height` on the
panel selects the small/medium/large `--ta-ui-size-disclosure-content-*` tokens (12/18/28rem by default).
Only the panel scrolls; the summary stays outside. Override these global tokens or the panel's
semantic hook in a consumer stylesheet to use other heights without component-local styles.

Action bars are unframed, wrapping groups with quiet neutral commands; they do not hide actions
until hover. Tooltip surfaces own their padding, foreground, and box sizing and inherit the
trigger's theme tokens. Native Popover plus `anchor-scope` and `position-area` support enables
viewport-aware top-layer placement, including direction flips without component-inline coordinates.
Each tooltip scopes its anchor independently, so adjacent items cannot attach to one another.
The local CSS fallback supports all four directions but may be clipped by ancestor overflow;
consumers targeting browsers without these native capabilities can replace the positioning rules.
