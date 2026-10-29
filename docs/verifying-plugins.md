# Verifying a plugin change

A plugin that installs is not a plugin that works. This is the detail behind the
short checklist in [AGENTS.md](../AGENTS.md#verifying); every rule here exists
because a change once looked shipped while the running Host still served the old
bundle.

A plugin that installs is not a plugin that works.

- **Read the boot output.** `dsh web` prints one line per entry that failed to
  activate, plus the tokenized URL. Fatal failures also write
  `~/.dsh/logs/startup-*.log`; "did not activate" warnings only go to stdout.
- A bare `curl` gets **401**; use the tokenized URL. `EADDRINUSE` means a stale
  process holds the port (`lsof -nP -iTCP:<port> -sTCP:LISTEN`).
- **Ask the running instance what it is before trusting it.** `dshx status`
  reports the live DSH's pid, port, profile, launch time, the checkout revision
  it was launched on (read back from the jj operation log), whether the checkout
  moved since, how many plugin bundles were rebuilt after launch, and which
  owned bundles have unbuilt edits. `dshx status --json` gives the same facts
  (plus the full stale-bundle list) for comparing two runs, and
  `dshx plugins list` lists every loaded plugin entry with its activation phase.
  A plugin whose sources are newer than its `dist/`, or a served bundle older
  than your edit, explains a change that "is not there" before any code reading.
- `dsh --profile web --dump-config` shows what a profile actually loads.
- After every build, import-check the Host bundle with the DSH Node:
  `fnm exec --using="$(cat .node-version)" node -e "import('./dist/index.js')"`.

## Repository checks

When changing a plugin, do **not** run the full repository or plugin test suite
by default. Use `pnpm test:related <changed-file>` for a focused source change or
`pnpm test:changed --from <base>` for a set of changes; run only additional
checks needed for the affected boundary (for example, the relevant E2E journey
for a changed user flow). Docs-only changes need no tests. Widen to the plugin's
full suite or repository-wide checks only when the change crosses broader
contracts, a pre-landing/release gate requires it, or the focused checks expose
a reason. See [docs/incremental-checks.md](incremental-checks.md#test-selection)
for selection behavior and its full-suite fallbacks.

`node --run <script>` is faster than `pnpm run` and drops a bare argument
silently, so pass it after `--` or through the check's own environment variable
(`DSHX_E2E_ONLY=<plugin> node --run check:e2e`). The `check:diff`/`check:green`
split, the Turbo cache and `--force` rules, and the e2e scope rule live in
[docs/repository-checks.md](repository-checks.md).

## Rebuilt plugins reach the browser over HMR

A rebuilt `dist/client.js` reaches the browser without a restart; Host code does
not, and until a restart the old Host runs under the new client, so decode
snapshots with defaults and never assume a new field, method or settings
namespace. What needs a restart, how a failed reload behaves and what to report
are in [docs/plugin-reload.md](plugin-reload.md).

## Client boot failures are cross-plugin

A `Failed to load plugins` card lists symptoms. The first entry named is often
not the broken one: a plugin that throws during `apply` is the cause, and the
entries `pending (waiting for service: X)` are its innocent dependents. `dshx
check --boot` catches these across the installed set; `tsc` alone does not.

A client slot entry can also activate and then throw while rendering, which shows
no card at all. A shadowing cell (the sidebar is one) retires the entry and
renders the next registration, so a native fallback replaces the plugin's UI and
only the browser console says so. `check:plugin-boot` and the `@smoke` client-boot
scenario fail on both traces — the `[data-slot-error]` marker and the renderer's
`slot entry crashed in '<slot>'` line. **A plugin-ui `useQuery`/`useMutation` hook
needs a `PluginQueryProvider` in the entry's own tree**: dshx decorates slot
components with the API context, not the Query client, and the missing provider
throws exactly this way.
