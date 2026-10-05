## Execution status

| Phase | Status | Evidence boundary |
|---|---|---|
| P1 — VPS acceptance | Complete | Real SSH-tunnelled native API, PTY, workspace placement, restart, one bounded free-model turn, and MCP fixture; see `validation.md`. |
| P2 — identity, directory, CLI | Complete | Local x2, Pi, and VPS; distinct native IDs for identical workspace paths; remote CLI session creation, ambiguity rejection, wrong-token rejection, and restart persistence. |
| P3 — reliability | Complete | Wrong token, protocol pinning, live wrong-host-key rejection, reconnect, one-host outage isolation, and an admitted Pi session-create whose reply was dropped through the real SSH connector passed without replay. |
| P4 — first-class UI | Partial | Online host switching/session creation and Pi native runtime view passed; a prior report said the persistent view closed and reopened successfully. A later collaborative preview showed offline stale-card/reconnect and a Pi runtimeOpenView lease in a distinct loopback origin with a scratch workspace and zero console errors. Approval, upload, terminal interaction, popup close/reopen, and model-turn acceptance remain unverified. |
| P5 — second machine and rollout | Partial | Pi ARM64, VPS, and local runtimes passed concurrently; isolated profile source composition was inspected. A prior report said a pinned Pi service was active, but later ownership evidence did not verify a durable rollout path. Rollback and daily-profile activation remain pending. |

