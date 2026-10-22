# dshfiles

Personal DeepSeek Harness (DSH) setup: marketplace plugins we adopt, and
plugins we own. The repository runs on stock DSH 0.2.1-rc.2; it carries no
core patches. Never patch DSH core from this repository or recommend a core
patch as a fallback. If a need cannot be expressed through supported dshx or
plugin APIs, document the concrete Host/core gap in `plans/dsh-host-gaps.md`
and stop at that boundary. Work in a separate DSH source checkout only when the
human explicitly redirects the task there.

## Skills

Load the matching skill from `.agents/skills/` before the work it covers:

- `plugin-ui` — any plugin UI or styling; adding shadcn components to the kit.
- `plugin-state` — Query / Form / xstate / localStorage in plugin clients.
- `dsh-plugin-verify` — after changing a plugin, before saying it works.
- `live-performance-audit` — before planning any performance work, and to prove a fix with before/after numbers.
- `verify-dsh` — launch, drive and screenshot a scratch DSH (`dshx dev up|doctor|open|shot|down`).
- `maintain-verify-dsh` — after changing how DSH is launched, seeded, driven or verified (e2e support, `dshx dev`, catalog schema, profile seeding, a feature's UI path).
- `dsh-sessions` — review, watch or debug another DSH thread (digest, tail, export) from a shell.
- `complete-plan` — when a plan's last task is done and verified: move its durable content into docs and delete it.

Shared skills (`~/.agents/skills/`) for the same kinds of work:

- `actor-state-ownership` — who owns which state when a component grows machines, effects or refs.
- `antislop` — fixing lint findings and promoting antislop rules.
- `runtime-boundary-audit`, `library-architecture` — Host/client boundaries and the dshx public surface.
- `safe-transformations` — codemods: version pins, namespace classes, renames across plugins.
- `focused-validation` — the narrowest check that proves a change.
- `memory-curation` — the memory plugin's stored memories.
- `jj-merge-workspaces` — landing several workspaces onto `main`.
- `disk-space-cleanup` — stale workspaces, `node_modules` and build output.

## Performance work: measure the live GUI first

Slow requests, laggy thread switches and slow New thread have been "fixed" several
times from source reading, request logs and scratch fixtures, and each time the
plan was a helper plugin or a core patch. The real costs (a dshx settings read
recomposing the profile per Session event, 42k DOM nodes from hidden collapsed
groups, `warm()` catalogs on every composer mount) only showed up on the live
instance. So, before proposing any fix:

1. Run the `live-performance-audit` probes on :3080: Host lag, per-click switch
   probe (DOM, long tasks, bytes, requests), and a CPU profile of the running
   Host. Attribute every interaction over 250 ms to Host stall, browser queue,
   payload or rendering.
2. Fix the owner the numbers name: an owned plugin, dshx, or a fork of the native
   Loader row. Record a Host gap only for Host-side costs, with the numbers.
3. Prove it with the same probe before and after, and keep the table in
   [docs/performance.md](docs/performance.md).

## Adopt, port, or build

- **Adopt** a plugin from [dshmarket.com](https://dshmarket.com) whenever one
  covers the need — a maintained community plugin beats a thin one we maintain.
- **Port** when an existing project already does the hard part: keep its
  license and provenance, vendor the code here, and name the result for what it
  does here. `../bb-plugins` is a source of behavior and working code, not a
  spec; reimplement against the DSH API.
- **Build with dshx** when a port would carry more debt than the feature is
  worth.
- **Replace native UI through an owned plugin** when we want DSH core's
  behavior as the baseline but need product-specific UX. Disable the stock
  Loader row in profile composition, fill its supported slots from the owned
  plugin, and keep the upstream license, source/version provenance, and an
  explicit update policy. This is not a blanket fork of core; see
  [native plugin overrides](docs/native-plugin-overrides.md). When the
  behavior lives in a native client package's private state (no slot can
  reach it), fork the whole package as `rich-composer`, `chat` and
  `session-controller` (Host side included) do. That is the supported route,
  not a core patch, and it is often the only real fix. Every fork is listed in
  [native forks](docs/native-forks.md) with a `native-fork.json`; run
  `node scripts/native-fork-diff.mjs` after touching one.

Say which option you chose and why. Two rules keep the choice honest:

- **Verify against the installed runtime, not the README.** Read a plugin's peer
  ranges against our DSH version, resolve the imports it uses, and read the
  Service contract it calls.
- **Check the Host can do it before building UI.** If a Service has no such
  method, a plugin cannot add one; record it in `plans/dsh-host-gaps.md` instead
  of faking it client-side.

When dshx cannot express something a plugin needs, fix dshx rather than
shipping a workaround: an `as unknown as`, a local `declare module`, or a
restated interface is a toolchain bug report. Keep such abstractions narrow and
name the plugin that forced them.

**A contract another plugin imports is a dshx module, not an exports trick.**
Declare it in `dshx.config.ts` — `modules: { 'attention-api': 'src/attention-api.ts' }`
— and publish the matching `exports` subpath (`"./attention-api"`: types from the
source, `default` from `dist/attention-api.js`); `dshx build` emits the entry,
keeps its bare imports external, and fails when the subpath is missing. Never
point a runtime export at raw TypeScript source, and never restate another
plugin's API schemas locally: both make the contract drift silently.

## Never restart the running DSH instance

The `web` profile runs on `127.0.0.1:3080`, usually with other agents mid-turn.
Never kill or restart it; reloading it is the user's decision. Verify on a
second instance instead, with a scratch `DSH_HOME` when the change touches
stored state:

```sh
DSH_HOME=/private/tmp/dsh-verify dsh web --port 3199 --no-open
```

Report what the second instance shows and let the user decide when to restart.

A plugin's `dist/` keeps serving after its sources are gone, so a deleted source
file looks harmless until the next rebuild. Confirm nothing serves a file before
removing it; `jj file show -r <change> <path>` restores one from any revision.

## References in chat

- Refer to DSH conversations with their native session reference (the rich
  thread/session reference), not a code-formatted or abbreviated `session-…`
  or `thread-…` identifier. Include the conversation title or a short purpose
  summary when it helps identify it.
- Refer to Jujutsu revisions and bookmarks with the `jj:<name>` form, e.g.
  `jj:main` or `jj:94526da8`. A `thread-<id>` workspace directory is not itself
  a revision or bookmark: call it a JJ workspace in prose, and link its actual
  revision with `jj:` when one is relevant. Never invent `jj:thread-<id>`.

## Version control

This is a [Jujutsu](https://jj-vcs.github.io) repository colocated with git.
Work lands on `main`; never `jj git push` without asking.

- Do parallel work in your own workspace, never in someone else's checkout:
  `jj workspace add ../dshfiles-<topic> --name <topic> -r main`, or a thread
  workspace created by `@dshfiles/jj-integration` (see its
  [README](plugins/@dshfiles/jj-integration/README.md); **Rebase** moves it
  onto `main`).
- One described revision per logical change: Conventional Commit title, a body
  that says why, and the `Co-Authored-By` trailer. `jj describe -m …`, then
  `jj new` before the next change.
- Never rewrite a revision another workspace holds as its `@` (describe,
  squash, rebase, abandon): it leaves a divergent copy of the change. Touch
  only revisions you created, and not ones another workspace is built on:
  amending an ancestor rebases that workspace and leaves it stale. Add a new
  revision instead.
- `jj workspace add` without `--ignore-working-copy`: with it, jj registers
  the workspace but never checks its files out.
- To move a checkout that may hold someone's uncommitted edits (e.g.
  `~/dev/dshfiles`) onto `main`, use `jj rebase -r @ -d main`; `jj new main`
  leaves those edits behind in the old revision.
- After moving `main` by hand (`jj bookmark set main …`), bring the checkout
  DSH runs from along: `node tooling/dshx/packages/dshx/dist/cli/bin.js
checkout sync` (`--dry-run` to preview). It rebases the `default` workspace
  keeping its local edits, rebuilds what changed and says whether DSH needs a
  restart; it never restarts DSH. Rebase does this itself.
- Always pass `-m` to `jj describe` and `jj squash` (or
  `--use-destination-message`); a bare command opens an editor and hangs.
- Check `jj log -r 'conflicts()'` after a rebase.
- Long runs: keep a `plans/<topic>/README.md` progress table with a "Resume
  here" line and commit after each milestone. When a plan's last task is done
  and verified, run the `complete-plan` skill: its durable content moves into
  the owning docs and the plan is deleted (see `plans/README.md`).

## Environment

Node comes from **fnm**, pinned by `.node-version`, not from Nix.

```sh
nix develop      # or: direnv allow
node -v          # must print the .node-version value
```

`dsh` must run on the official Node build: Nix's `nodejs` fails at boot with
`node-addon-require-builtin unsupported`. The dev shell strips
`~/.nix-profile/bin` from `PATH` and puts fnm first; if `node -v` prints a Nix
version, fix the shell before debugging anything else.

## Profiles

Profiles live in `~/.dsh/profiles/<name>/`. Registry packages go through
`dsh plugin --profile <name> add <package>`; owned bundles go through
`pnpm profile:sync --profile <name>`, because `pnpm add <path>` cannot express a
local bundle. Read [`docs/profile-installs.md`](docs/profile-installs.md)
before touching a profile manifest.

The checked-in seed is `profiles/web/`. `scripts/profile-sync.ts` is the only
reconciler: it seeds missing files into the writable `~/.dsh/profiles/web/`,
applies the seed's plugin dependencies and the marked Cordis region, and keeps
user-added entries and edits outside that region. The nixfiles `dsh web`
supervisor runs it before every start and restart, `dshx checkout sync` runs it
when the seed changed, so a seed change reaches the live profile on the next
restart without `nixapply`. See
[`docs/profile-installs.md`](docs/profile-installs.md#the-web-profile-reconciles-itself).

A seed row outside the marked region never reaches an existing live profile.
When a DSH release renames a service or a prompt variable and you fix a seed row
for it, tell the user the live row needs the same edit — two 0.2.1 breakages
(`webRuntime` → `webStartup`, the `{{cwd}}` persona suffix) were fixed in the seed
and stayed broken live.

Experiment in `probe` (or a disposable profile), never in `web`. `probe` is not
Nix-managed, has its own `node_modules`, and gets its own port:

```sh
pnpm profile:sync --profile probe
fnm exec --using="$(cat .node-version)" pnpm profile:boot --profile probe
pnpm --dir plugins/@dshfiles/<name> test
# once it earns its place: add it to profiles/web/package.json; the next restart links it
```

When `probe` has unrelated activation failures, isolate the target with the
dshx E2E `bootPluginProfile('@dshfiles/<name>')` fixture, which boots a
disposable home with the base web bundles plus the selected bundle. Promote on
measured evidence; remove abandoned experiments from every profile they reached.

## DSH upgrades and recovery

Never upgrade the global `@deepseek-ai/dsh` in place; use
`scripts/dsh-lkg/cli.mjs upgrade <version>`, which proves the new core against
the live profile first. When DSH is broken, the user's way out is `dsh lkg`
(port 3099, with their accounts and threads). The runbook is
[`docs/recovery.md`](docs/recovery.md).

## Writing plugins

New plugins use our dshx hard fork at `tooling/dshx` (`@dshfiles/dshx`;
provenance in [`FORK.md`](tooling/dshx/FORK.md)). It has no upstream remote and
must not install `@becomeopc/dshx` from a registry. Build it, then scaffold:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@dshfiles/dshx
node tooling/dshx/packages/dshx/dist/cli/bin.js create my-plugin --cwd plugins/@dshfiles --template ui --style css-modules
dshx inspect slots --root sidebar     # read the live composition instead of guessing
```

`dshx create` accepts only an unscoped project slug; set both the package
manifest and `dshx.config.ts` name to `@dshfiles/my-plugin` before building.

Docs: [authoring guide](tooling/dshx/docs/sdk/getting-started.md),
[compatibility](tooling/dshx/docs/compatibility.md) (check before assuming a
0.1 API exists).

- Every plugin joins the workspace contract
  (`plugins/scripts/check-workspace-contract.ts`): `build`, `test` and
  `typecheck` scripts, and a `tsconfig.json` that extends the root
  `tsconfig.base.client.json` (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`,
  `isolatedModules`) without turning a flag off. Every plugin
  also needs at least one end-to-end journey in the running client.
- Workspace manifests name exact versions outside `peerDependencies`; a version
  two manifests share goes in the `catalog:` of `pnpm-workspace.yaml`. The same
  contract script rejects ranges.
- Owned plugins are Cordis bundles: `cordis.patch.yml` inserts the package row,
  `dist/index.js` is the Host half, `dist/client.js` the browser half.
- **Every plugin that renders UI ships a screenshot.** A plugin whose catalog
  lists a `client` surface keeps at least one capture in
  `plugins/@dshfiles/<name>/docs/screenshots/`, embedded under its README title
  and named after the catalog feature it walks. Refresh it — the whole shot, or
  only the screen that changed — after a significant UI change (a new surface, a
  moved control, a restyle), never for copy. `node --run check:screenshots` fails
  a UI plugin without one; `pnpm screenshots` captures them from a scratch DSH.
  See [plugin screenshots](docs/plugin-screenshots.md).
- **A capability the user has, the Agent gets.** Every user-facing capability a
  plugin serves — a row action, a dialog verb, a settings write — carries an
  agent tool too: bind the existing dshx method with
  `tool: { name, readOnly, render }` rather than adding a second `defineTool`
  that restates it. Reads set `readOnly: true`; write tools say in their
  description that they may run only when the user asked; a destructive verb
  takes an explicit opt-in argument with no default, so a bare request cannot
  destroy work. Presentation-only state (tab layout, a lightbox, a draft) is not
  a tool. When no Host verb exists, record the gap in
  [`plans/dsh-host-gaps.md`](plans/dsh-host-gaps.md) instead of faking the action
  client-side. The per-owner audit and backlog live in
  [`docs/agent-tool-parity.md`](docs/agent-tool-parity.md).
- Loader row ids share one namespace per profile: keep the scope in the id
  (`@dshfiles/shortcuts` → `dshfiles-shortcuts`). `defineSettings.namespace`
  must equal that row id, and one Host entry cannot declare both native
  `Config` and dshx `settings`.
- A plugin and dshx must resolve **one** `@deepseek-ai/cordis` (including
  `cordis-plugin-include` and `cordis-plugin-loader`). Two copies make
  `declare module` augmentations land on the wrong `Events`. The versions are
  pinned in root `pnpm-workspace.yaml` with `dedupePeerDependents: true`.

### Plugin UI and state

Client UI uses `@dshfiles/plugin-ui` (shadcn/ui on Tailwind v4); skills
`plugin-ui` and `plugin-state` hold the details. The rules that break silently:

- Every utility is `dshx:`-prefixed, a complete static string, merged with
  `cn`; `dshx-root` on each surface root; semantic colors only.
- `@dshfiles/ui-styles` is the only bundle that compiles the shared sheet;
  after **any** class change, rebuild it and the plugin you changed.
- Host/async data → `/query`, multi-field forms → `/form`, tangled flows →
  `/machine`, localStorage → `createStoredValue`.
- Prefer Host utilities (`relativeTime`, `writeClipboard`, `rankByName` from
  `@deepseek-ai/dsh-client-ui-primitives`) over local copies.
- **Multi-select only when a repeated row verb is worth batching.** Add it to
  a list whose rows share a routine verb (move, mark, enable, stop) and whose
  batch saves real work; skip it for detail panes and for lists whose rows have
  unrelated actions. Use one model: plain click selects one row — or runs the
  row's existing verb when it already has one — Cmd/Ctrl-click toggles the
  selection, Shift-click extends the inclusive range from the anchor, and the
  header checkbox selects exactly the rows visible under the current filter,
  group or scope; changing any of those drops ids that are no longer visible.
  A batch action keeps each single-row verb's rules, refusals and confirmations,
  and a bulk destructive verb (forget, stop, remove) opens an explicit
  confirmation that names the count — it never runs from a bare click.

### Credentials: store a reference, never a value

DSH never echoes a secret value back, so a setting or form field cannot hold one
and round-trip. Every credential-using feature stores `secret:ALIAS` (or
`secret:ALIAS@env`) and resolves it on the Host:

- The grammar, schemas and `SecretReferenceResolver` come from
  `@dshfiles/credential-port`; bundle it in the Host entry
  (`host.bundleDependencies`) and never restate the regex locally.
- `ctx.get('secretCatalogValues').resolve({ reference, cwd })` is the only
  value read. It never crosses to a Client; keep an environment-variable
  fallback when the feature has one.
- A field that should offer the vault is marked `data-secret-input="reference"`
  (plain HTML) or, in a settings schema, `Schema.string().role('secret-ref')`.
  Never import the Catalog's picker from another plugin.
- See [docs/secret-references.md](docs/secret-references.md) for the contract and
  `plugins/@dshfiles/secret-catalog/README.md` for the implementation.

## Shell command batching

DSH's `bash` tool is exclusive: several `bash` calls in one turn run one after
another. Chain independent shell reads in one call (`;` for independent, `&&`
for dependent, `echo "---LABEL---"` between sections) and pipe noisy output
through `head`/`tail` inside that call. Prefer `read` for single files; it runs
concurrently.

One exception is worth a dedicated call anyway: `node scripts/jj-state.mjs`
prints this workspace's `@`, working copy, conflicts, `main | main@origin` and
the revisions above `main` in one process. Prefer it over four or five separate
`jj status` / `jj log` calls — the 2026-10-15..18 sessions logged 10k+ `jj`
invocations, p50 1s each. Add `--read-only` (implies `--ignore-working-copy`)
before inspecting another workspace, and `--repo <path>` to target one.

## Waiting

Never `sleep` and never loop a discovery tool to pass time; both hold the turn
with nothing running.

| Waiting for          | Do this                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| A background command | `background_jobs_wait` (Host-side, no polling); a bounded `job_output` wait only when the job is nearly done |
| Another agent        | `send_message` it, or end the turn — its reply resumes you                                                   |
| The user             | async `ask_user_question`, or a `schedule_*` reminder; a pending question or the next message resumes you    |
| Thread questions     | `list_thread_questions` once, with `sessionId` when known; never in a poll loop                              |

## Definition of done

Before claiming completion, run the narrowest check and say what it proves:
reproduce, state the root cause, apply the smallest fix, then write
`Verified: <command> → <result>` and `Unverified: <what you could not measure>`.
The 2026-10-15..22 window logged 245 “incomplete or unfixed” pushbacks; a claim
without a fresh check is the pattern behind them. See `focused-validation`.

## Verifying

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

### Repository checks

`node --run <script>` is faster than `pnpm run` and drops a bare argument
silently, so pass it after `--` or through the check's own environment variable
(`DSHX_E2E_ONLY=<plugin> node --run check:e2e`). The order, the
`check:diff`/`check:green` split, the Turbo cache and `--force` rules, and the
e2e scope rule live in
[docs/repository-checks.md](docs/repository-checks.md).

### Rebuilt plugins reach the browser over HMR

A rebuilt `dist/client.js` reaches the browser without a restart; Host code does
not, and until a restart the old Host runs under the new client, so decode
snapshots with defaults and never assume a new field, method or settings
namespace. What needs a restart, how a failed reload behaves and what to report
are in [docs/plugin-reload.md](docs/plugin-reload.md).

### Client boot failures are cross-plugin

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
