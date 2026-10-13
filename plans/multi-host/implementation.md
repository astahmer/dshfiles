## Execution status

| Phase | Status | Evidence boundary |
|---|---|---|
| P1 — VPS acceptance | Complete | Real SSH-tunnelled native API, PTY, workspace placement, restart, one bounded free-model turn, and MCP fixture; see [package validation receipts](../../plugins/@dshfiles/multi-host/docs/validation.md). |
| P2 — identity, directory, CLI | Complete | Local x2, Pi, and VPS; distinct native IDs for identical workspace paths; remote CLI session creation, ambiguity rejection, wrong-token rejection, and restart persistence. |
| P3 — reliability | Complete | Wrong token, protocol pinning, live wrong-host-key rejection, reconnect, one-host outage isolation, and an admitted Pi session-create whose reply was dropped through the real SSH connector passed without replay. |
| P4 — first-class UI | Superseded | Replaced by the New thread host chip, hosts dialog, remote thread view and Remote sidebar section (2026-10-13); see the [multi-host README](../../plugins/@dshfiles/multi-host/README.md) and [validation](../../plugins/@dshfiles/multi-host/docs/validation.md#host-chip-and-remote-threads-2026-10-13). Earlier notes: online host switching/session creation and the Pi native runtime view passed; a prior report said the persistent view closed and reopened. Later collaborative preview showed offline stale-card/reconnect and a Pi runtimeOpenView lease in a distinct loopback origin with a scratch workspace and zero console errors. The OpenCode Go profile and 30-model catalog rendered. After the replacement credential was installed for the Pi deployment, its Go models request was reported as HTTP 200 and the runtime check found the key loaded; a separate local alias probe returned HTTP 401. Those scopes remain unreconciled, so provider acceptance and a model turn remain unverified. Approval, upload, terminal interaction, and popup close/reopen as a distinct flow also remain unverified. |
| P5 — second machine and rollout | Partial | Pi ARM64, VPS, and local runtimes passed concurrently; isolated profile source composition was inspected. A prior report said a pinned Pi service was active, but later ownership evidence did not verify a durable rollout path. Rollback and daily-profile activation remain pending. The latest source update again reports the pinned release active under a declarative systemd user service; this integration did not verify that deployment. |


### Prior status snapshot (2026-10-05)


| Phase | Status | Evidence boundary |
|---|---|---|
| P1 — VPS acceptance | Complete | Real SSH-tunnelled native API, PTY, workspace placement, restart, one bounded free-model turn, and MCP fixture; see [package validation receipts](../../plugins/@dshfiles/multi-host/docs/validation.md). |
| P2 — identity, directory, CLI | Complete | Local x2, Pi, and VPS; distinct native IDs for identical workspace paths; remote CLI session creation, ambiguity rejection, wrong-token rejection, and restart persistence. |
| P3 — reliability | Complete | Wrong token, protocol pinning, live wrong-host-key rejection, reconnect, one-host outage isolation, and an admitted Pi session-create whose reply was dropped through the real SSH connector passed without replay. |
| P4 — first-class UI | Partial | Online host switching/session creation, offline stale-card/reconnect, and the Pi native runtime view in a distinct browser origin passed in the collaborative preview. Approval, upload, terminal interaction, and the UI popup's close/reopen cycle still lack browser proof. |
| P5 — second machine and rollout | Partial | Pi ARM64 plus VPS and local runtimes passed concurrently; source profile registration was checked in an isolated nixfiles workspace. Durable declarative supervision and daily-profile activation remain pending. |


