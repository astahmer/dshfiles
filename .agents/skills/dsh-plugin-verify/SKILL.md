---
name: dsh-plugin-verify
description: Build and verify an owned DSH plugin without touching the live instance — host-bundle import check, HMR vs restart, old-host tolerance, settings/Config rules, probe and scratch profiles, browser-console checks and perf budgets. Use after changing any plugin under plugins/@dshfiles/*, before reporting it works, or when a plugin "did not activate" / a slot crashes.
---

# Verifying a DSH plugin

Never restart or kill the live `web` DSH on `127.0.0.1:3080` (see AGENTS.md). Verify in `probe` or a throwaway
scratch profile.

## 0. Workspace preflight

Identity and stale-artifact failures read like plugin bugs. Clear them first:

```sh
fnm exec --using="$(cat .node-version)" pnpm --dir plugins install --frozen-lockfile   # lockfile matches the tree
fnm exec --using="$(cat .node-version)" pnpm --dir plugins run contract                # every package has build/test/typecheck
```

A stale lockfile, a second copy of a `@deepseek-ai/*` package, or a plugin
package without a `test` script all fail in ways that look like plugin code.
Diff the failing paths against your own change before editing the plugin.

## 1. Build and import-check

```sh
cd plugins/@dshfiles/<plugin>
pnpm typecheck && pnpm test && pnpm build
fnm exec --using=22.23.3 node -e "import('./dist/index.js')"   # 22.23.3 = .node-version, the DSH Node
```

An import failure here is exactly what shows up at boot as "did not activate". `dist/` is not versioned.
Changed classes? Rebuild `@dshfiles/ui-styles` too (skill `plugin-ui`).

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

Once the change is on `main`, `dshx checkout sync` moves the live checkout, rebuilds the changed plugins and reports
which row applies to each.

## 3. Host contract rules

- `useApi` / `useSettings` only in components registered through dshx `decorate(...)` (or `defineSlot`); otherwise
  the first render throws "unavailable outside a DSHX Client Slot component".
- One Host entry cannot declare both native `Config` and dshx `settings` — split the entry.
- `defineSettings.namespace` must equal the Loader row id in `cordis.patch.yml` (new plugins: `dshfiles-<plugin>`).
- Editing a profile's `cordis.patch.yml` by hand is fine only **outside** the Nix-managed marked block
  (`~/.config/nixfiles/modules/dsh.nix` reconciles that block on apply).

### Capabilities other plugins and the agent use

One dshx API serves Clients, other Host plugins and (opt-in) the agent; see
`tooling/dshx/docs/guides/api.md#one-registry-other-plugins-clients-and-the-agent`.

- A contract another package imports sets `owner` and gives each method a `description`.
- Agent tool that wraps API logic → `method({ ..., tool: { name, readOnly } })`, not a second `defineTool`
  restating the parameters. Keep `readOnly` off for anything that writes.
- Host code calls another plugin with `createHostApiClient(ctx, contract, packageId)`, never a Cordis
  service grab or an HTTP fetch.
- An absent owner is `isApiOwnerMissing(error)` (Host and Client): stop polling and hide the feature; never
  match transport message text.
- Verify: `dshxRegistryApi.list` (the Agent toolkit page, `@dshfiles/agent-toolkit`) shows the method, its
  description and its agent tool.

## 4. Run it

```sh
# from the repository root
pnpm profile:sync --profile probe
fnm exec --using="$(cat .node-version)" pnpm profile:boot --profile probe   # read every "did not activate" line
```

In the browser (tokenized URL from boot output): check the console for `slot entry crashed` and `Failed to load
plugins`; the first entry named is often a dependent, not the cause.

To see the change in the Web UI without the live DSH, use skill `verify-dsh` (`dshx dev up --plugin
@dshfiles/<plugin>`, `open <feature>`, `shot`, `down`): it handles the scratch home, the provider dialog and
project registration without the native folder picker.

## 5. Perf budget

UI work must not regress the palette budgets (palette open, keystroke frame, style recalc, one shared `@dshfiles`
stylesheet) asserted by `tooling/dshx/e2e/features/palette-performance.feature` (`pnpm --dir tooling/dshx test:e2e`).

Report: build/typecheck/test results, import check, what probe/scratch showed, and whether a user restart is needed.
