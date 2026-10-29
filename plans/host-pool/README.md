# Resource-aware host placement and fleet visibility

Scope: [automatic host selection](b:346) and [host resource visualization](b:356), built on one bounded resource-snapshot API. Preserve manual Local/runtime choices and keep Auto as a one-shot action that resolves to a concrete runtime before the existing folder and thread-bootstrap flow; do not add a persisted `auto` destination kind.

| Milestone | Status | Evidence |
| --- | --- | --- |
| 1. Add validated local/remote resource snapshots, stale-aware caching, and deterministic least-pressure selection. | pending | |
| 2. Add Auto to the new-thread host picker and prove the created thread uses the resolved destination. | pending | |
| 3. Show the same CPU and memory snapshots on the Hosts page, with stale/unavailable states. | pending | |
| 4. Run focused plugin/E2E and scratch-DSH verification; capture the changed UI and update both backlog items. | pending | |

Resume here: implement the remote resource snapshot endpoint and bounded cache in `@dshfiles/multi-host`; the remote identity contract already requires that plugin, so this avoids SSH shell probes and works through the existing runtime gateway. Then resolve Auto to the existing concrete Local/runtime destination before folder selection, preserving persisted destination compatibility.
