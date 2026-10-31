# dshfiles

Shared DeepSeek Harness (DSH) setup: marketplace plugins we adopt, and
plugins we own. The repository runs on stock DSH 0.2.1-rc.2; it carries no
core patches. Never patch DSH core from this repository. Prefer an adopted or
forked official plugin when it fits; otherwise an owned plugin may implement a
bounded capability using supported Host/dshx services, including plugin-owned
versioned storage, lifecycle and execution. A missing native Host verb is not
by itself a reason to stop: first test whether a Host plugin can own the full
contract safely. Record a concrete residual Host/core gap and stop only when no
supported plugin-owned implementation can meet the required guarantees; never
fake a native method or durable state in the client. Work in a separate DSH
source checkout only when the human explicitly redirects the task there.

## Skills

Load the matching skill from `.agents/skills/` before the work it covers:

- `dsh-upstream-sync` — review or sync Astahmer's dshfiles into this fork; preserve owned plugins and shared-plugin deltas.
- `dsh-upstream-pr` — prepare or publish a selected plugin change to Astahmer without unrelated fork changes.
- `plugin-ui` — any plugin UI or styling; adding shadcn components to the kit.
- `plugin-state` — Query / Form / xstate / localStorage in plugin clients.
- `dsh-plugin-verify` — after changing a plugin, before saying it works.
- `live-performance-audit` — before planning any performance work, and to prove a fix with before/after numbers.
- `verify-dsh` — launch, drive and screenshot a scratch DSH (`dshx dev up|doctor|open|shot|down`).
- `maintain-verify-dsh` — after DSH launch, seed, verification, or UI changes (`dshx dev`, e2e support, catalog schema, profile seeding).
- `dsh-sessions` — review, watch or debug another DSH thread (digest, tail, export) from a shell.
- `complete-plan` — when a plan's last task is done and verified: move its durable content into docs and delete it.
- `traces-first` — when something is slow or failing: read the stored traces (`traces_*` tools) before reading code.

Shared skills (`~/.agents/skills/`) for the same kinds of work:

- `actor-state-ownership` — who owns which state when a component grows machines, effects or refs.
- `antislop` — fixing lint findings and promoting antislop rules.
- `runtime-boundary-audit`, `library-architecture` — Host/client boundaries and the dshx public surface.
- `safe-transformations` — codemods: version pins, namespace classes, renames across plugins.
- `focused-validation` — the narrowest check that proves a change.
- `memory-curation` — the memory plugin's stored memories.
- `jj-linearize` — collapsing many heads, duplicates or divergent copies above a base into one linear line (replaces the retired `jj-merge-workspaces`).
- `verification-skill` — create or maintain a project's scripted `verify-<app>` loop (replaces the former create/maintain pair).
- `disk-space-cleanup` — stale workspaces, `node_modules` and build output.

## Performance work: measure the live GUI first

Slow requests, laggy thread switches and slow New thread have been "fixed" several
times from source reading, request logs and scratch fixtures, and each time the
plan was a helper plugin or a core patch. The real costs (a dshx settings read
recomposing the profile per Session event, 42k DOM nodes from hidden collapsed
groups, `warm()` catalogs on every composer mount) only showed up on the live
instance. So, before proposing any fix:

1. Run the `live-performance-audit` probes against the actual current runtime: Host lag, per-click switch
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

Say which option you chose and why. Three rules keep the choice honest:

- **Verify against the installed runtime, not the README.** Read a plugin's peer
  ranges against our DSH version, resolve the imports it uses, and read the
  Service contract it calls.
- **Find agent-tool ownership before asking for another checkout.** For a
  reported tool failure, search this repository for the exact tool name and
  error text, especially under `plugins/@dshfiles/*` and tool registrations.
  Familiar names such as `apply_patch` may be owned by a local plugin rather
  than DSH core. If found, fix and verify that plugin in this workspace; ask for
  another source checkout only after confirming the implementation is absent.
- **Check the Host boundary before building UI.** A plugin cannot add a method
  to a native Service, but it may expose its own Host API and own the needed
  state/workflow when supported services (for example storage domains and
  subprocesses) provide the required semantics. Prefer an adopted/forked
  official plugin or a focused owned plugin. Record a gap only for guarantees
  that remain unavailable after this plugin-owned feasibility check; never fake
  a native method or durable state client-side.

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

**Plugin dependencies point one way.** When plugin A shows something plugin B
produces, A (the owner of the screen or slot) declares a `defineContract` or
`defineRegistry` token as a dshx module and B, which already depends on A,
provides it; A renders nothing when B is absent. Add a separate integration
plugin only when the integration is large and both sides must work without it.
Never close a cycle with an optional peer dependency: `pnpm check:cycles` fails
on any cycle. See [plugin boundaries](docs/plugin-boundaries.md).

## Never restart the running DSH instance

Never kill or restart the live instance: other agents may be mid-turn.
Reloading/restarting is the user's decision. Read the active URL, profile and
launcher from current runtime context; never infer them from a checked-in
personal port, home path or profile name. Configure deployment choices in
machine-local settings, not shared defaults; see
[personal configuration](docs/personal-configuration.md).

An explicitly configured `dsh` launcher can use the Astahmer-derived supervisor;
once active, the existing sidebar offers **Restart when idle**. This is a
whole-Host restart, not a backend hot swap. Do not assume that supervisor is
installed or active just because its source exists.

Use a scratch home/profile and the pinned official core for verification.
Inspect any custom wrapper before relying on `HOME`/`DSH_HOME` isolation. Prefer
the isolated verifier/fixture or a scratch-only raw-core shim that preserves the
supplied environment; never copy private account state into shared fixtures.

After merging plugin work, build the affected artifacts in the canonical checkout:
a worktree-only build or a source-only merge does not update the served bundle.
With `hmr-gate` active, client-only rebuilds hot-reload and paired Host/client
rebuilds are deferred with a restart notice. Never request that restart without
the user's authorization; do not promise protection for manual page refreshes,
new tabs, every external dependency or jobs outside running Agent turns.
Report scratch evidence and whether the live supervisor/gate is actually active.

A plugin's `dist/` keeps serving after its sources are gone, so a deleted source
file looks harmless until the next rebuild. Confirm nothing serves a file before
removing it; `jj file show -r <change> <path>` restores one from any revision.

## References in chat

- Whenever a referenced entity has a native link/reference form, use it in the
  message so it renders as a link instead of leaving a bare identifier or label.
  For example, use `b:<id>` for backlog items, `jj:<name>` for Jujutsu revisions
  and bookmarks, and the native rich session reference for DSH conversations.
  Keep these references unformatted in ordinary prose; don't wrap them in quotes
  or code spans that can prevent the reference renderer from recognizing them.
- Refer to DSH conversations with their native session reference (the rich
  thread/session reference), not a code-formatted or abbreviated `session-…`
  or `thread-…` identifier. Include the conversation title or a short purpose
  summary when it helps identify it.
- Refer to Jujutsu revisions and bookmarks with the `jj:<name>` form, e.g.
  `jj:main` or `jj:94526da8`. A `thread-<id>` workspace directory is not itself
  a revision or bookmark: call it a JJ workspace in prose, and link its actual
  revision with `jj:` when one is relevant. Never invent `jj:thread-<id>`.
- Refer to a configured DSH Agent with the explicit `@{handle}` link reference
  (for example, `@{luna}`) when linking to it in prose. Plain `@handle` remains
  the dispatch mention syntax; do not use it as a substitute when a link is
  intended.
- Use Markdown links for ordinary URLs and repository files when the chat
  renderer does not provide a native reference form.

## Version control

Detect the checkout's actual VCS metadata before choosing commands. The upstream
setup uses [Jujutsu](https://jj-vcs.github.io) colocated with Git, but this fork
may be cloned as Git-only. Without `.jj`, use a separate named Git worktree and
normal Git commands; do not initialize JJ to satisfy these instructions. The JJ-specific rules below apply only in a JJ checkout. Do not rewrite or
switch another agent's worktree by default; preserve dirty files. A direct human
request may explicitly authorize a scoped history rewrite across those
workspaces. See [the fork workflow](docs/fork-maintenance.md).

Work lands on `main`; never push with either Git or JJ without authorization.

- Do parallel work in your own workspace, never in someone else's checkout:
  `jj workspace add ../dshfiles-<topic> --name <topic> -r main`, or a thread
  workspace created by `@dshfiles/jj-integration` (see its
  [README](plugins/@dshfiles/jj-integration/README.md); **Rebase** moves it
  onto `main`).
- One described revision per logical change: Conventional Commit title and a
  body that says why. Do not add `Co-Authored-By` trailers or local DSH agent
  handles to commit metadata; they are not GitHub collaborators. `jj describe
-m …`, then `jj new` before the next change.
- Before history edits, inspect JJ workspace ownership and check `jj status` in
  every affected workspace. Do not rewrite another workspace's `@` or its
  ancestors by default. A direct human request to consolidate that history is a
  scoped exception: inspect affected thread state, snapshot before each risky
  step, preserve dirty and unlanded work, and rebase rather than abandon it. If
  an owner reports interference, pause that lane and coordinate before
  continuing. Authorization to rewrite does not imply authorization to discard
  work or push.
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
- For `jj_details`, pass the full 40- or 64-character hexadecimal commit hash;
  short prefixes used in chat or accepted by the jj CLI fail its API schema.
  Resolve the full hash from `jj log` or `jj_load` before calling it.
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
user-added entries and edits outside that region. An explicitly configured
launcher can reconcile it before startup; `dshx checkout sync` can run it when
the seed changes. Do not assume any external machine configuration or automatic
live deployment. See
[`docs/profile-installs.md`](docs/profile-installs.md#the-web-profile-reconciles-itself).

A seed row outside the marked region never reaches an existing live profile.
When a DSH release renames a service or a prompt variable and you fix a seed row
for it, tell the user the live row needs the same edit — two 0.2.1 breakages
(`webRuntime` → `webStartup`, the `{{cwd}}` persona suffix) were fixed in the seed
and stayed broken live.

Experiment in a disposable `probe` profile, never the active live profile.
Keep its home, dependencies and port isolated from the running installation:

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
a separately selected profile first. Recovery tooling is optional: inspect its
local configuration and private-copy behavior before invoking `dsh-lkg`.
The runbook is
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
  destroy work. For each new user-visible state transition, include a way to see
  the resulting state and, where meaningful, reverse or reopen it; test both
  paths or state why the transition is intentionally irreversible.
  Presentation-only state (tab layout, a lightbox, a draft) is not a tool. When
  no native Host verb exists, do not fake it client-side: first consider a
  Host-side plugin API with plugin-owned state and supported services. Record a
  gap in [`plans/dsh-host-gaps.md`](plans/dsh-host-gaps.md) only if that route
  cannot satisfy the contract. The per-owner audit and backlog live in
  [`docs/agent-tool-parity.md`](docs/agent-tool-parity.md).
- **Host work leaves a span, and the catalog says which.** Every feature in
  `dshx.features.json` lists `telemetry`: the `automatic` spans it already gets
  (`api-dispatch`, `agent-tool`, `model-stream`, or the shared `jj` / `secret`
  / `multi-host` helpers), a `custom` span with the `recordSpans()` test that
  asserts it, or a `not-applicable` reason (client-only, pure functions). Host
  code that fetches, opens a socket, spawns a process or runs a long job wraps
  that work unit in `withSpan`/`traced` (one span per unit, named
  `<subject> <verb>`, identities and counts only) or names its caller's span in
  `ioDelegation`. `features:check` and `dshx build` fail an addition or update
  that skips this. See
  [the telemetry contract](docs/observability.md#the-telemetry-contract-checked).
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
`plugin-ui` and `plugin-state` carry the workflow. The rules that break silently
— `dshx:` utilities with `cn`, no native `title` or `<select>`, rebuild
`@dshfiles/ui-styles` after a class change, project pickers over thread
workspaces, multi-select only for a batchable row verb — are in the
[kit README](plugins/@dshfiles/plugin-ui/README.md#rules-that-break-silently).

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

## Editing after inspection

`edit` refuses a file the native `read` never read; bash `cat`/`rg`, `grep` and
`ast-outline` do not register that receipt. After inspecting that way, use
`apply_patch` (atomic write, reads first, whitespace-tolerant anchors) or read
the file first.

## Delegation and recovery

- For substantial work, consider whether independent, bounded parts would benefit
  from subagents. Delegate when it improves coverage or speed; do not optimize for
  agent count. Integrate and verify their results.
- After a DSH restart or failed model request, inspect the persisted transcript and
  current workspace before resuming. Check which subagents and jobs completed, remain
  active, or failed, and what work they left behind. Continue surviving work;
  re-dispatch only unfinished work that was actually stopped or lost, with
  non-overlapping scope. Do not repeat a task just because the parent turn was
  interrupted.

## Waiting

Never `sleep` and never loop a discovery tool to pass time; both hold the turn
with nothing running.

| Waiting for          | Do this                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| A background command | `background_jobs_wait` (Host-side, no polling); a bounded `job_output` wait only when the job is nearly done |
| Another agent        | `send_message` it, or end the turn — its reply resumes you                                                   |
| The user             | async `ask_user_question`, or a `schedule_*` reminder; a pending question or the next message resumes you    |
| Thread questions     | `list_thread_questions` once, with `sessionId` when known; never in a poll loop                              |

## Warnings and errors

Every user-facing warning or error must include an actionable recovery path: tell the user what they can change or do next, and offer a direct control or exact command when available. If no safe recovery exists, explain the limitation and the next practical alternative; never leave the user with a dead-end message.

## Definition of done

Before claiming completion, run the narrowest check and say what it proves:
reproduce, state the root cause, apply the smallest fix, then write
`Verified: <command> → <result>` and `Unverified: <what you could not measure>`.
The 2026-10-15..22 window logged 245 “incomplete or unfixed” pushbacks; a claim
without a fresh check is the pattern behind them. See `focused-validation`.

## Verifying

A plugin that installs is not a plugin that works: read the boot output, ask
`dshx status` what the running instance is, and import-check the built Host
bundle. `dsh --profile web --dump-config` shows what a profile loads; a bare
`curl` gets 401. Focused checks first (`pnpm test:related`), never the full suite
by default. Full detail, including HMR-versus-restart and the cross-plugin shape
of a client boot failure: [docs/verifying-plugins.md](docs/verifying-plugins.md).
