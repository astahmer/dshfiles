# Rebuilt plugins reach the browser over HMR

What a rebuilt bundle does and does not update, and when only a Host restart
helps. `AGENTS.md` keeps the short version; this page is the detail.

`@deepseek-ai/dsh-client-hmr` polls each bundle every 500 ms and pushes a graph
frame, so a rebuilt `dist/client.js` reaches the browser without a restart. This
profile replaces that row with [`@dshfiles/hmr-gate`](../plugins/@dshfiles/hmr-gate),
which keeps the poll and both frame kinds but announces a rebuild only while the
package's Host half is the code the running Host loaded. A rebuild whose Host half
changed is announced as `deferred` instead: the browser keeps the last-good client
code and Settings → Plugins shows an **HMR updates** row naming what a restart
would apply. Deferring is the only rollback available, because the browser tears
the old code down when it receives the frame and the Host serves the current file
for every rev.

The stock Host's `hmr` entry would be on in `web` — it is disabled only when the
launcher supplies no `profileContext` — with `root: []`: it watches the profile
manifest and both user patch files, so ordinary plugin enable/disable and
`cordis.patch.yml` edits recompose the running Host, and a recomposition also
replaces the plugins whose linked-package files changed on disk — our
`link:`-installed bundles included.

This repository turns it **off**: `- id: hmr` / `disabled: true` in the seed's
NIX-MANAGED region and, until that row reaches the live file, as a local row.
A replacement dropped `sessionQuery` and took `session-controller` down twice on
2026-10-19, so nothing recomposes a live `web` Host today and every plugin
rebuild waits for a restart (see [recovery](recovery.md) and the
[HMR gate plan](../plans/hmr-compat-gate/README.md)). What a stock Host reports
when it does need a restart, which is the user's call:

- a failed or unavailable module comparison, logged as
  `restart required: module-comparison`
- a publication the runtime resolution rejects, such as a retained profile
  mapping whose directory moved (`restartReason: 'package-moved'`)
- Host code no recomposition reaches: `root: []` watches no source tree, and
  `dshx dev.hostHmr` stays a development-only opt-in `web` does not enable

Until then the live DSH runs the **old Host** under the **new client**: decode
Host snapshots once at the boundary with defaults, never assume a new field or
method exists, and fall back to defaults when the settings namespace is
unregistered. Do not HMR-remove an old keybinding or event owner before its
replacement is live.

A reload is not a rollback. Once the old client fiber is torn down, a failed
replacement leaves the plugin broken in that page — Settings → Plugins → Plugin
list retries it — and a failed Host replacement stops the plugin and reports its
entry `failed`. Revisions are bundle metadata (mtime, ctime, size), so a rewrite
that preserves all three never reloads, while a metadata-only touch reloads the
plugin with fresh component state. A page also applies graphs only from the
release it booted, and it closes `/plugins/events` for good when a restarting
Host answers that route non-200 before registering it: the page then updates
nothing and learns of no release change until it is reloaded. Reload a tab you
want kept in sync after a Host restart.

Report the stages separately: source validated, web seed updated, profile synced,
live runtime confirmed. If the active profile was not synced, say so.

## A slot `inject` callback must not throw

`ClientEntries.replace()` tears the old client fiber down **before** the
replacement imports and applies (`@deepseek-ai/dsh-client-modules`
`lib/client.js:492-505`, DSH #6883). A slash-menu overlay, a queue dock or the
transcript can render inside that window. A slot `inject` callback that throws
when its provider is momentarily missing therefore crashes the entry, and the
renderer logs `slot entry crashed in '<slot>'` — the shape of the 2026-10-22
composer crash.

Resolve a Session-scoped service where the value is **used**, not while `inject`
builds its face, and render a degraded/empty face while it is absent. The
2026-10-23 audit fixed every owned site that threw from `inject`:

| Site | Before | Now |
| ---- | ------ | --- |
| `queue-reorder` dock | threw on missing scope/`conversation` | resolves per call, rejects the action with "reconnecting" |
| `rich-composer` composer bar | `concreteConversation` threw during inject; `inputHub.shell` threw without a binding | controller registered before the slots, and the bar renders its absent face without a binding and resolves `conversation` per action |
| `rich-composer` input hub | `inputTriggers.sessionOf` threw for a scope of a replaced generation | `isRetainedScope` (`src/retained-scope.ts`) checks the binding first |
| `rich-composer` queue dock | threw on missing scope/`conversation` | same per-call guard as `queue-reorder` |
| `chat` view + flow | threw on a missing `ctx.sessions.binding` | detached empty faces (`src/detached-injected.ts`) |
| `input-trigger` slash menu | threw when the Session scope was absent or no longer the retained binding | closed-menu face |

Registration order alone does not close the window: the old fiber, and its
`conversation` service, is gone while a stale entry can still render. Keep the
guard in the `inject` itself.

Owned helpers for a native fork live **outside** its vendored directory
(`src/`, not `src/native/`): `scripts/native-fork-diff.mjs` reports any file it
cannot map to upstream as drift.

Throwing **after** an await inside a user action (rename, pin, archive) is not
this problem: the error propagates through the action that owns it.
