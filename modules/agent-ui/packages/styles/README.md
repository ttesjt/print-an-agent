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
import '@ta-agent/ui-styles/forms.css';
import '@ta-agent/ui-styles/feedback.css';
import '@ta-agent/ui-styles/overlays.css';
import '@ta-agent/ui-styles/navigation.css';
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
overlays, navigation, and the general component stylesheet all occupy the public components layer.
Consumer styles loaded afterward can override semantic hooks or any `--ta-ui-*` token without
changing component behavior.
