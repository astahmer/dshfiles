# HMR gate design

Why the gate exists, what it decides and what it leaves to other fixes. The behavior and the checks are in the
[README](../README.md); the reload rules for every plugin are in [plugin reload](../../../../docs/plugin-reload.md).

## The incident

On 2026-10-22 the composer of a live thread died in the Web UI while the Host stayed healthy:

```text
Error: queue dock: conversation service unavailable
Error: ui-conversation: conversation service unavailable
slot entry crashed in 'conversation.input.dock'
slot entry crashed in 'conversation.composer.bar'
```

`dshx status` showed 26 bundles built after the Host started, `@dshfiles/rich-composer` among them, and warned that
client HMR may serve them while the running Host has not loaded them. Both messages came from the client bundles of
owned forks (`queue-reorder`'s dock and `rich-composer`'s composer bar), each throwing from a slot `inject` callback
when the `conversation` service was missing.

## Two failure classes, two fixes

| Class                      | Trigger                                                                                                                                                                                          | Fix                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| A — Host/client skew       | `dist/index.js` is rebuilt while the Host runs; client HMR delivers the new client against the old Host                                                                                          | this gate                                                                                                |
| B — client teardown window | HMR reload of a service-providing plugin: `ClientEntries.replace()` tears the old fiber down before the replacement imports and starts (DSH #6883), and a live slot entry renders in that window | owned plugins: provider before consumers and an `inject` that never throws (see [plugin reload][inject]) |

The gate does not fix class B. Which class caused the 2026-10-22 crash was never replayed; both are covered.

[inject]: ../../../../docs/plugin-reload.md#a-slot-inject-callback-must-not-throw

## What the runtime does

- `@deepseek-ai/dsh-client-hmr` stat-polls each client bundle every 500 ms, calls `ctx.clientModules.rebuilt(id)` and
  pushes `{ type: 'rebuilt', id, rev }` over `/plugins/events`; the client half calls `ctx.modules.entries.reload`.
- The page's release gate compares `WebBootRelease = { version, commit }`, which is the DSH build. A rebuilt plugin
  never changes it, so the page cannot see plugin-level skew.
- Host recomposition (`@deepseek-ai/dsh-hmr`) is disabled in the `web` profile on purpose (see
  [recovery](../../../../docs/recovery.md)), so a rebuilt Host half waits for a restart by policy.

The page protects itself against a DSH release change but not against a plugin bundle change. The gate is the missing
half of that recorded tradeoff.

## Decisions

- **Gate on the Host side.** The Host is the only place that knows what it loaded, and the stock client half already
  does the right thing once frames are honest. The client half is vendored unchanged; the notice subscribes to the same
  route from this package's own entry.
- **Deferring is the rollback.** `entries.reload()` is the only teardown, and the Host serves the current file for
  every rev, so not sending the frame is what keeps the last-good code live.
- **Announce, do not withhold silently.** The `deferred` frame and `hmr_gate_status` name the package and the reason,
  following VS Code's extension host, which never activates new code in an old host and says a reload is required.
  Vite and Metro likewise turn an update they cannot apply into a full-reload verdict with a reason.
- **Compare the Host artifact's bytes.** The package's Host entry is resolved from its own `package.json`
  (`exports['.']`, then `main`), so native packages (`lib/index.js`) and owned bundles (`dist/index.js`) both resolve.
  A file the gate cannot read is deferred, not announced.
- **Never a core patch.** The fork plus a profile row are supported surfaces on stock DSH.

Options rejected:

| Option                                                        | Why not                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-enable Host recomposition so the Host half reloads in step | It re-opens the 2026-10-19 `sessionQuery` wedge. Cordis HMR, which `@deepseek-ai/dsh-hmr` forks, unloads the old plugin before activating the new one, with no last-good. |
| Gate on the client and query the Host for compatibility       | More moving parts for knowledge the Host already has.                                                                                                                     |
| Recovery only (watch `entries.state`, retry, reload banner)   | It does not prevent the skew. Retry and reload actions remain a possible addition to the notice.                                                                          |
| Build discipline (never rebuild a Host bundle under the Host) | Cannot be enforced, and routine work already does it.                                                                                                                     |

OpenCode 2's plugin supervisor is the precedent for class B: it publishes a generation only after the new revision
imports and sets up, and the TUI says the previous version is still active on a failed swap. It has no answer for class
A because it never runs a separately built client against an older server.

## What it does not do

- Restart the Host: that stays the user's call, because it ends every session.
- Roll back a reload that already applied.
- Replace the Host half of a package no recomposition reaches.
- Make a broken client bundle work.
- Turn Host HMR back on. Where a profile does enable it, a `hmr/reload` event releases the deferral without a restart.
