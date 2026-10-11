---
name: dsh-plugin-verify
description: Build and verify an owned DSH plugin without touching the live instance — host-bundle import check, HMR vs restart, old-host tolerance, settings/Config rules, probe and scratch profiles, headless turns with drive.mjs, browser-console checks and perf budgets. Use after changing any plugin under plugins/@dshfiles/*, before reporting it works, or when a plugin "did not activate" / a slot crashes.
---

# Verifying a DSH plugin

Never restart or kill the live `web` DSH on `127.0.0.1:3080` (see AGENTS.md). Verify in `probe` or a throwaway
scratch profile.

## 0. Workspace preflight

Identity and stale-artifact failures read like plugin bugs. Clear them first:

```sh
fnm exec --using="$(cat .node-version)" pnpm --dir plugins install --frozen-lockfile   # lockfile matches the tree
fnm exec --using="$(cat .node-version)" pnpm --dir plugins run contract                # every package has build/test/typecheck
ls -l plugins/node_modules/@deepseek-ai/dsh-api-session-controller                    # must link into tooling/dsh-core
```

A `link:` override that resolved to the published `0.2.0-rc.2`, a
`tooling/dsh-core/*/lib` older than the `src/` beside it, or a plugin package
without a `test` script all fail in ways that look like plugin code. AGENTS.md
holds the rules (dshx fork, vendored core) and the exact overrides to keep in
step; diff the failing paths against your own change before editing the plugin.

## 1. Build and import-check

```sh
cd /Users/astahmer/dev/dshfiles/plugins/@dshfiles/<plugin>
pnpm typecheck && pnpm test && pnpm build
fnm exec --using=22.23.3 node -e "import('./dist/index.js')"   # 22.23.3 = .node-version, the DSH Node
```

An import failure here is exactly what shows up at boot as "did not activate". `dist/` is not versioned.
Changed classes? Rebuild every UI plugin (skill `plugin-ui`).

## 2. HMR or restart?

| Change | Reaches the running DSH |
|---|---|
| `dist/client.js` (client code, CSS) | HMR within ~500 ms, no restart |
| `dist/index.js` host code, `package.json`, `cordis.patch.yml`, settings namespace, profile composition | only after the **user** restarts |

So the live DSH keeps running the **old host** while new clients hot-reload. Clients must tolerate it:

- Decode Host snapshots once at the boundary with defaults; never assume a new field or method exists
  (`accounts.refreshUsage().catch(() => accounts.usage())` in `ai-accounts/src/accounts-queries.ts`).
- The settings namespace may be unregistered on the old host (`namespace-unregistered`, `writable: false`) → fall
  back to defaults, never throw.

## 3. Host contract rules

- `useApi` / `useSettings` only in components registered through dshx `decorate(...)` (or `defineSlot`); otherwise
  the first render throws "unavailable outside a DSHX Client Slot component".
- One Host entry cannot declare both native `Config` and dshx `settings` — split the entry.
- `defineSettings.namespace` must equal the Loader row id in `cordis.patch.yml` (new plugins: `dshfiles-<plugin>`).
- Fork-only session events are written with `ignorable: true` so stock DSH can still read the logs
  (`tooling/dsh-core/session/src/index.ts`).
- Editing a profile's `cordis.patch.yml` by hand is fine only **outside** the Nix-managed marked block
  (`~/.config/nixfiles/modules/dsh.nix` reconciles that block on apply).

## 4. Run it

```sh
cd /Users/astahmer/dev/dshfiles
pnpm profile:sync --profile probe
fnm exec --using="$(cat .node-version)" pnpm profile:boot --profile probe   # read every "did not activate" line
```

Real agent turns, headless, on an isolated scratch home copied from `probe`:

```sh
node plugins/@dshfiles/optmem/scripts/drive.mjs <out.json> <full|compat> <scenario.json>
# REAL_HOME=1 uses the real ~/.dsh; STOCK=1 runs without the fork
```

In the browser (tokenized URL from boot output): check the console for `slot entry crashed` and `Failed to load
plugins`; the first entry named is often a dependent, not the cause.

## 5. Perf budget

UI work must not regress `plans/ade/perf-baseline.md` (palette open, keystroke frame, style recalc, one shared
`@dshfiles` stylesheet). The guard is `tooling/dshx/e2e/features/palette-performance.feature`
(`pnpm --dir tooling/dshx test:e2e`).

## 6. After history surgery

A consolidated or rebased line can join two variants of one change and still merge cleanly, so a green gate from
*before* the rewrite proves nothing about the tree *after* it. Split the check in two:

```sh
jj diff --from <pre-surgery-tip> --to <post-surgery-tip> --stat   # 0 files => same code, gates still hold
jj diff --from <base> --to <tip> --summary                        # for the lint/fmt drift remainder
```

- 0 files: the earlier `contract -> build -> typecheck -> test` run still describes the tree; report it as carried
  over, not re-run.
- Anything else: re-run the four gates on the new tip before trusting it. A revision split must pass the same
  0-file gate against the tip it replaced.

Report: build/typecheck/test results, import check, what probe/scratch showed, and whether a user restart is needed.
