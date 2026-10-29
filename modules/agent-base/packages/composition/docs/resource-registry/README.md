# Composition Resource Registry

Use `@ta-agent/base-composition/resource-registry` to compile typed resource providers into
a Blueprint. Each Scope owns the acquisitions made through its Registry and releases them in
reverse dependency order. A caller can supply eligible borrowed roots or reuse an existing Scope
with the same Blueprint. Consumers receive the resolved capabilities through their explicit ports.
