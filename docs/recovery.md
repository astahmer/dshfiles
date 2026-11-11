# Recovering a broken DSH

A blank page, failed plugin activation or failing turns can come from source,
built artifacts, profile configuration, core or Node. A source checkout alone
does not capture all of those layers. Do not restart an active shared Host or
change its writable profile without the user's authorization.

## 1. Identify the selected installation

Read the current runtime context and local launcher configuration. Do not copy
another operator's profile name, checkout path or network address. The checked-in
`web` seed is an example composition, not proof of the live profile; see
[personal configuration](personal-configuration.md) and
[profile installs](profile-installs.md).

| Layer            | Inspect                                                       | Rewound by a source revision? |
| ---------------- | ------------------------------------------------------------- | ----------------------------- |
| DSH core         | The actual installed `@deepseek-ai/dsh` entry and version     | No                            |
| Writable profile | Selected profile manifest and patch under the chosen DSH home | No                            |
| Built plugins    | The selected source packages' `dist` output                   | Only after a rebuild          |
| Node             | The official runtime pinned by `.node-version`                | No                            |

Useful read-only checks from the repository root:

```sh
dsh --version
node scripts/dsh-lkg/cli.mjs list
```

Inspect what `dsh` resolves to first: a locally installed wrapper can select a
different core/home. Keep startup diagnostics private; they may include paths or
account metadata. A successful HTTP shell load is not proof that Session APIs
or client plugin activation work.

## 2. Plugin safe mode

When a plugin breaks boot (the GUI shows **Failed to load plugins**, stays
blank, or the launcher refuses because a plugin build fails), boot the same
home with only DSH core and the owned bundles that own a data format, then
restore. Safe mode never writes your profile: it composes a sibling profile
`<profile>-safe` and records what it left out.

```sh
# from the dshfiles checkout; --profile is the profile you normally boot
node scripts/safe-mode.mjs start --profile web
# stop the running DSH yourself (Ctrl-C in its terminal), then boot:
scripts/dsh-launcher                 # configured launcher: boots web-safe while safe mode is on
dsh --profile web-safe               # or the stock CLI
# fix or remove the broken plugin, stop the safe-mode DSH, then:
node scripts/safe-mode.mjs stop --profile web
scripts/dsh-launcher                 # or: dsh --profile web
```

`start` prints the exact boot and restore commands for the home it used
(`--home <DSH home>`, default `DSH_HOME`, the launcher's `dshHome`, then
`~/.dsh`). `status` reports whether safe mode is on. Neither command stops or
restarts a running DSH: that stays your call.

What the safe profile loads:

| Kept                                                                               | Why                                                                                    |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Every `@deepseek-ai/*` bundle the profile lists                                    | the stock GUI and Host                                                                 |
| `@dshfiles/session-persistence-jsonl`, plus each `--keep <bundle>`                 | its Session logs store tool catalogs by reference; the stock reader cannot expand them |
| Your `cordis.patch.yml` entries for rows that still exist (port, models, accounts) | the same URL and defaults as usual                                                     |

It drops every other bundle (owned and third-party), your patch entries for rows
that left with them, inserts of non-core modules, and your entries for native
rows a dropped bundle replaces. For example, the seed disables the stock
`session-query-sqlite` because session-search owns `sessionQuery`; with
session-search off, the stock row must come back or the session controller
never activates. The drop list is in
`<home>/profiles/<profile>-safe/.dshfiles-safe-mode.json`.

The same home means the same Sessions, credentials and plugin storage. A
setting changed during safe mode lands in the safe profile and is discarded by
`stop`. The configured launcher boots the safe profile without its usual
`pnpm install`, plugin build and relink steps, so a failing build cannot block
recovery; its **Restart when idle** re-reads safe mode on each restart.

Crash safety: `start` composes in a hidden staging directory and marks the
profile `active` only after a `--dump-config` of the final composition
succeeds; the launcher ignores anything not `active`. `start` and `stop`
remove leftovers of an interrupted run. Both are idempotent, and both refuse
while a DSH runs the safe profile. `stop` reports whether your profile is
byte-identical to when safe mode started.

Limits: a bundle whose own `cordis.patch.yml` no longer parses, or a broken
kept bundle, still breaks composition; `start` fails without activating, and
`dsh-lkg` (below) is the next step. Turns use only native tools and providers
in safe mode.

Verified 2026-11-11 on a scratch home synced from the `web` seed (DSH
0.2.1-rc.2): with `@dshfiles/session-controller`'s Host entry made to throw,
the full profile showed **Failed to load plugins** (65 entries). `start` kept
`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app` and
`@dshfiles/session-persistence-jsonl`, turned off 102 bundles and 8 patch
entries; `web-safe` booted with no failed entries and the stock GUI resolved
its boot in headless Chromium. `stop` left the source manifest and patch
byte-identical, and the repaired full profile booted with no failure card.

## 3. Optional last-known-good recovery

The [LKG tooling](../scripts/dsh-lkg/README.md) can retain a self-contained runtime
snapshot, including core, plugin artifacts, profile and interpreter identity.
It is not installed or enabled merely by cloning this repository. Check its
actual local store and launcher before using `dsh-lkg` or `dsh-recover`.

A configured recovery launcher uses the stored runtime rather than current
source artifacts. By default it copies private live data into separate recovery
state; this includes credentials and Sessions. Obtain authorization for that
copy, restrict its permissions and keep it outside version control. It does not
prove that a provider accepts copied credentials now. Recovery-state changes do
not automatically flow back into the live installation.

The recovery script supports:

| Variable            | Effect                            |
| ------------------- | --------------------------------- |
| `DSH_LKG_CLEAN=1`   | Start without copying live data   |
| `DSH_LKG_LIVE_HOME` | Select the source DSH home        |
| `DSH_LKG_PORT`      | Select the recovery listener port |

Threads started during a recovery stay in its state, and the next recovery start
drops the previous state. `scripts/dsh-lkg/cli.mjs import-sessions` lists them,
and `--apply` copies the ones the live home lacks back into it; see
[the LKG README](../scripts/dsh-lkg/README.md#bring-recovery-threads-back-to-the-live-home).

Use the URL actually printed by the selected recovery launcher; never publish
its launch token. APFS clone support and macOS immutable flags are platform
features, not cross-platform guarantees. Read the implementation's platform
requirements before relying on them elsewhere.

## 4. Diagnose the owner

- **Waiting for service X / entries did not activate:** compare the selected
  live patch with the matching core and plugin service contracts. A seed change
  outside the managed region may not reconcile an existing custom profile.
- **`unknown prompt variable`:** inspect the selected preset row and the current
  core's prompt-variable contract.
- **`failed to import`:** build the affected package and import-check its Host
  bundle using the intended official Node runtime. A successful install alone
  is insufficient.
- **HTTP works but `sessionController` is unavailable:** inspect activation and
  recomposition diagnostics. The controller may be waiting for `sessionQuery`,
  whose selected provider must remain registered for the Host lifetime.
- **`node-addon-require-builtin unsupported`:** verify official Node rather than
  the Nix Node build. Do not change global installations as a speculative fix.
- **Missing platform-native binding:** inspect the actual global pnpm layout and
  platform package resolution. A global virtual-store layout can prevent the
  addon loader from resolving its platform package. Repair only the verified
  installation, with an authorized rollback point.

### Host recomposition can lose a Session provider

Historical inspection found that a fresh boot activated a composition whose
already-running Host lost its Session surface after linked artifacts and profile
patches changed. That evidence is a recomposition failure, not proof that the
same problem is occurring now. Correlate actual Host start time, artifact/patch
mtimes, activation errors and API failures before attributing a current incident.

The checked-in seed disables native Host HMR; client HMR is separate. Inspect
actual selected rows rather than assuming a seed was deployed. Plugin selection
changes and Host code updates then need a user-managed restart. With the HMR gate
active, paired Host/client updates may be deferred; without it, an old Host may
receive a new client. Decode compatible snapshots and report unavailable methods
honestly. See [plugin reload](plugin-reload.md).

### Restart from the UI (2026-11-11)

The live Host may already run under a supervisor: check read-only that its
process has `DSH_RESTART_RUN_ID` and `DSH_RESTART_REQUEST_PATH`
(`ps -E -o command= -p <host pid>`) and that the thread-sidebar
`thread-sidebar-restart.availability` API answers `available: true`. On
2026-11-11 it did (nixfiles `dsh-web-supervisor.mjs`), and on a scratch home the
same supervisor restarted the Host through the API every time (the 10 s exit
guard forces code 75, the page cookie survives, a new run id answers within
~50 s). What failed was detection: since the Effect refactor (#26) thread-sidebar
called the native client-module registry's `graph()`/`clientPath()` detached, so
`thread-sidebar-plugin-updates.pending` threw (`API handler failed`), the
sidebar stopped polling and only hmr-gate's deferrals ever reached the restart
item. Fixed in `fix(thread-sidebar): call the client module registry on itself`.

The opt-in `autoRestartWhenIdle` setting (thread-sidebar README, "Restarting by
itself") applies pending Host updates on its own once nothing runs; it uses the
same supervisor hand-off and does nothing without one.

An external supervisor may implement health probes or restart policies. Neither
its existence nor any machine-specific Nix configuration is guaranteed by this
repository. Do not install or enable a restart policy while diagnosing without
separate authorization.

## 5. Snapshot and upgrade only with authorization

Operator commands can copy private data, run paid provider traffic when a turn
check is selected, update installations or remove old snapshots. Inspect their
full behavior and selected paths first. `DSH_LKG_ADMIN=1` bypasses the agent guard;
it is not itself authorization to mutate the store.

```sh
# Operator-only, after explicit approval and local configuration review:
DSH_LKG_ADMIN=1 node scripts/dsh-lkg/cli.mjs snapshot --label "<reviewed change>"
DSH_LKG_ADMIN=1 node scripts/dsh-lkg/cli.mjs upgrade <version>
```

Do not upgrade the global core in place before proving the selected profile and
plugins against the candidate. Preserve the previous healthy snapshot when
checks fail. A source revert cannot reverse shared-data migrations; retain an
appropriate private backup and document what it actually covers. Record scratch
health checks separately from real-provider acceptance and live activation.
