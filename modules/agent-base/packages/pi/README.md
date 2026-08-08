# `@ta-agent/base-pi`

Pi infrastructure adapter for Agent Base-owned model and Agent Loop contracts.

This is the only Agent Base package that imports Pi or TypeBox. It uses Pi's low-level loop, translates
Agent Base-owned schemas at the adapter boundary, forces sequential tool execution, and delegates
every proposal to the run-scoped Agent Base Tool Broker. Pi and TypeBox types do not appear in the
public factories.

The deterministic faux profile supports offline multi-turn tool-loop tests. Text from intermediate
tool-use turns is suppressed; only ordered deltas from the terminal assistant turn are published.
The same profile implements Session compaction through Pi's direct completion boundary rather than
misrepresenting compaction as a full Agent Loop. It accepts only Agent Base-owned bounded values and
normalizes output and failure identities before returning. Ordinary local and remote provider
registration remains deferred.
