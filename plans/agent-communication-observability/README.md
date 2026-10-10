# Agent communication observability progress

| Milestone                                     | Status      | Evidence                                                                                                                                                   |
| --------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create dedicated JJ workspace from `main` tip | Complete    | `agent-communication-observability` at `/Users/astahmer/dev/dshfiles-agent-communication-observability`, parent `1788b54b7eb9e4151498ceef98ffb58f34392a45` |
| Plan and scope                                | Complete    | [Plan](../agent-communication-observability.md); staged order agreed                                                                                       |
| Read-only CLI / diagnostic report             | Complete    | Focused service, bridge, CLI tests; build/typecheck; metadata-only JSON/human report and v1 migration coverage                                             |
| DSH UI with safe controls                     | In progress | Begin after CLI checkpoint; use inspected `sidebar.panellist` → `main` slots and Host APIs                                                                  |
| Focused validation and scratch runtime        | In progress | Plugin import/build passes; scratch port 3199 composition boots, but bridge stays unavailable until `agents` Host setup is reached                         |

Resume here: add validated Host APIs for diagnostics, message details/reveal, subscription changes and acknowledgement; implement the inspector panel. Later, exercise Host setup with an actual scratch Agent without calling an external model if possible.
