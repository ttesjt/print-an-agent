# `@ta-agent/base-identity`

Stable, storage-independent Agent identity primitives.

An Agent ID is a logical namespace key, not a filesystem path. Adapters must still enforce path
containment and storage isolation independently.

```ts
import { defineAgentIdentity } from '@ta-agent/base-identity';

const identity = defineAgentIdentity({
  id: 'bro',
  displayName: 'Bro',
});
```

`id` is the immutable key used to address config, sessions, and resources. `displayName` is mutable
product data in the conceptual sense, but this value object is immutable; create a replacement
identity value when the display name changes. Never derive storage paths without a containment-safe
adapter.
