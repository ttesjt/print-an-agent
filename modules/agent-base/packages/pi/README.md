# `@ta-agent/base-pi`

Pi infrastructure adapter for Agent Base-owned model and Agent Loop contracts.

This is the only Agent Base package that imports Pi. It uses the low-level Pi loop and does not expose
Pi types from its public factories. The current offline profile uses Pi's deterministic faux provider;
ordinary local and remote provider registration is deferred.
