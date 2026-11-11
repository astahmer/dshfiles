# dshfiles

Shared DeepSeek Harness (DSH) setup: marketplace plugins we adopt, and plugins
we own. It runs on stock DSH 0.2.1-rc.2 with no core patches. The global
contract (`~/.dsh/AGENTS.md`) holds harness-neutral defaults; this file holds
dshfiles and DSH rules.

## Baseline rules

These apply even without the global contract.

1. Use `jj`, not `git`, in a JJ checkout. One logical change per revision:
   Conventional Commit title, body says why, no `Co-Authored-By` or agent
   handles.
2. Before a history edit, run `jj status` in each affected workspace. Never
   rewrite a revision another workspace holds as `@` or builds on. After a
   rebase, check `jj log -r 'conflicts()'`.
3. Read a file before you overwrite it. Fix the cause with the smallest edit.
4. Done means a fresh, focused check passed. A regression check fails before the
   fix and passes after. Report `Verified: <command> → <result>` and
   `Unverified: <what>`.
5. Never `sleep` or loop a tool to pass time. Wait on a notification, or end the
   turn with a named wake.
6. Never print secrets. Refer to them by env var name or `secret:ALIAS`.

## The core boundary

1. Never patch DSH core from this repository.
2. Prefer an adopted or forked official plugin when it fits.
3. Otherwise, an owned plugin may implement a bounded capability with supported
   Host/dshx services, including plugin-owned versioned storage, lifecycle and
   execution.
4. A missing native Host verb is not by itself a reason to stop. A plugin cannot
   add a method to a native Service, but it can expose its own Host API and own
   the state and workflow. First test whether a Host plugin can own the full
   contract safely.
5. Only when no supported plugin-owned implementation meets the required
   guarantees: record the concrete residual gap in
   [`plans/dsh-host-gaps.md`](plans/dsh-host-gaps.md) and stop.
6. Never fake a native method or durable state in the client.
7. Work in a separate DSH source checkout only when the human explicitly
   redirects the task there.

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

## Performance and RAM: measure the live instance first

Fixes planned from source, request logs or scratch fixtures missed the real
costs (a dshx settings read recomposing the profile per Session event, 42k DOM
nodes from hidden collapsed groups, `warm()` catalogs on every composer mount).
Only the live instance showed them. Before you propose a fix:

1. Run the `live-performance-audit` probes on the current runtime: Host lag,
   per-click switch probe (DOM, long tasks, bytes, requests), and a CPU profile
   of the running Host. Attribute each interaction over 250 ms to Host stall,
   browser queue, payload or rendering.
2. Fix the owner the numbers name: an owned plugin, dshx, or a fork of the
   native Loader row. Record a Host gap only for Host-side costs, with numbers.
3. Prove it with the same probe before and after. Keep the table in
   [docs/performance.md](docs/performance.md).
4. Before you change what a Host or browser tab holds, read
   [RAM usage](docs/ram-usage.md): how to measure (settle 110 s, close the
   inspector, never census a live Host — one census pinned 2.3 GB and OOMed
   it), a 610 MB Host's composition, and the bounding patterns (byte budgets on
   per-client streams, retention on derived stores, FTS `optimize`, WAL limits,
   demand-gated indexers, lazy stores). Sweep:
   [performance.md](docs/performance.md#ram-sweep-2026-11-08).

## Adopt, port, or build

Choose one and say why:

1. **Adopt** a plugin from [dshmarket.com](https://dshmarket.com) when one
   covers the need: a maintained community plugin beats a thin one we maintain.
2. **Port** when an existing project does the hard part. Keep its license and
   provenance, vendor the code here, name the result for what it does here.
   `../bb-plugins` is a source of behavior and working code, not a spec:
   reimplement against the DSH API.
3. **Build with dshx** when a port carries more debt than the feature is worth.
4. **Replace native UI through an owned plugin** when DSH core's behavior is the
   baseline but the UX must change. Disable the stock Loader row in profile
   composition, fill its supported slots from the owned plugin, and keep the
   upstream license, source/version provenance and an explicit update policy.
   This is not a blanket core fork; see
   [native plugin overrides](docs/native-plugin-overrides.md). If the behavior
   is in a native client package's private state (no slot reaches it), fork the
   whole package, as `rich-composer`, `chat` and `session-controller` (Host side
   included) do. That is the supported route, not a core patch, and often the
   only real fix. List each fork in [native forks](docs/native-forks.md) with a
   `native-fork.json`. Run `node scripts/native-fork-diff.mjs` after you touch
   one.

Rules for every option:

1. Verify against the installed runtime, not the README: read a plugin's peer
   ranges against our DSH version, resolve its imports, read the Service
   contract it calls.
2. Reported tool failure? Search this repository for the exact tool name and
   error text, especially `plugins/@dshfiles/*` and tool registrations. Familiar
   names such as `apply_patch` can belong to a local plugin, not DSH core. Fix
   and verify that plugin here. Ask for another checkout only after you confirm
   the implementation is absent.
3. Before you build UI, check the Host boundary
   ([The core boundary](#the-core-boundary)).
4. When dshx cannot express what a plugin needs, fix dshx. An `as unknown as`, a
   local `declare module` or a restated interface is a toolchain bug report.
   Keep such abstractions narrow and name the plugin that forced them.
5. A contract another plugin imports is a dshx module, not an exports trick.
   Declare it in `dshx.config.ts` —
   `modules: { 'attention-api': 'src/attention-api.ts' }` — and publish the
   matching `exports` subpath (`"./attention-api"`: types from the source,
   `default` from `dist/attention-api.js`). `dshx build` emits the entry, keeps
   its bare imports external, and fails when the subpath is missing. Never point
   a runtime export at raw TypeScript source. Never restate another plugin's API
   schemas locally. Both make the contract drift silently.
6. Plugin dependencies point one way. When plugin A shows what plugin B
   produces, A (owner of the screen or slot) declares a `defineContract` or
   `defineRegistry` token as a dshx module; B, which already depends on A,
   provides it; A renders nothing without B. Add a separate integration plugin
   only when the integration is large and both sides must work without it.
   Never close a cycle with an optional peer dependency: `pnpm check:cycles`
   fails on any cycle. See [plugin boundaries](docs/plugin-boundaries.md).

## Never restart the running DSH instance

1. Never kill or restart the live instance: other agents may be mid-turn.
   Reload and restart are the user's decision. Never request a restart without
   the user's authorization.
2. Read the active URL, profile and launcher from the runtime context, never
   from a checked-in personal port, home path or profile name. Put deployment
   choices in machine-local settings, not shared defaults
   ([personal configuration](docs/personal-configuration.md)).
3. An explicitly configured `dsh` launcher can use the Astahmer-derived
   supervisor. When active, the sidebar offers **Restart when idle**: a
   whole-Host restart, not a backend hot swap. Its source existing does not mean
   it is installed or active.
4. Verify with a scratch home/profile and the pinned official core. Inspect a
   custom wrapper before you rely on `HOME`/`DSH_HOME` isolation. Prefer the
   isolated verifier/fixture or a scratch-only raw-core shim that keeps the
   supplied environment. Never copy private account state into shared fixtures.
5. After you merge plugin work, build the affected artifacts in the canonical
   checkout. A worktree-only build or source-only merge does not update the
   served bundle.
6. With `hmr-gate` active, client-only rebuilds hot-reload; paired Host/client
   rebuilds wait behind a restart notice. Do not promise protection for manual
   refreshes, new tabs, every external dependency, or jobs outside running
   Agent turns. Report scratch evidence and whether the live supervisor/gate is
   actually active.
7. A plugin's `dist/` keeps serving after its sources are gone. Confirm nothing
   serves a file before you remove it. `jj file show -r <change> <path>`
   restores one from any revision.

## References in chat

Use the native reference form when one exists, unformatted: quotes or code spans
stop the renderer.

1. Backlog items: `b:<id>`.
2. Jujutsu revisions and bookmarks: `jj:<name>` (`jj:main`, `jj:94526da8`). A
   `thread-<id>` directory is a JJ workspace, not a revision: name it so, and
   link its revision with `jj:` when relevant. Never invent `jj:thread-<id>`.
3. DSH conversations: the native rich session reference, not a code-formatted or
   abbreviated `session-…`/`thread-…` id. Add the title or purpose when it
   helps.
4. Configured DSH Agents: the `@{handle}` link (`@{luna}`). Plain `@handle` is
   the dispatch mention, not a link.
5. Other URLs and repository files: Markdown links.

## Version control

Detect the checkout's VCS metadata first. Upstream uses
[Jujutsu](https://jj-vcs.github.io) colocated with Git; this fork may be
Git-only. Without `.jj`, use a separate named Git worktree and Git commands; do
not initialize JJ. The JJ rules below apply only in a JJ checkout. Do not
rewrite or switch another agent's worktree by default; preserve dirty files. See
[the fork workflow](docs/fork-maintenance.md). Work lands on `main`. Never push
(Git or JJ) without authorization.

1. Work in your own workspace, never in someone else's checkout. An agent
   (subagents included) calls `jj_thread_isolate` before its first edit and
   works in the absolute path it returns: a managed thread workspace from
   `main`, guarded by its Session. When its work lands (`jj_thread_rebase` with
   that `path`, or any rebase that keeps its revisions' ancestry — not
   `jj duplicate`), Host cleanup removes it with its `node_modules`.
2. Never tell a subagent to run a raw `jj workspace add`: that workspace has no
   owning Session, and its folder stays after it is forgotten. A human outside
   DSH may use `jj workspace add ../dshfiles-<topic> --name <topic> -r main` (see
   the jj-integration [README](plugins/@dshfiles/jj-integration/README.md)).
   Never add `--ignore-working-copy`: jj then never checks the files out.
3. Per change: `jj describe -m …`, then `jj new`. Always pass `-m` to
   `jj describe` and `jj squash` (or `--use-destination-message`): a bare
   command opens an editor and hangs.
4. A direct human request may authorize consolidating history across other
   workspaces. Then inspect affected thread state, snapshot before each risky
   step, preserve dirty and unlanded work, and rebase instead of abandoning. If
   an owner reports interference, pause that lane and coordinate. Rewrite
   authorization does not authorize discarding work or pushing.
5. To move a checkout that may hold someone's uncommitted edits (for example
   `~/dev/dshfiles`) onto `main`: `jj rebase -r @ -d main`. `jj new main` leaves
   those edits in the old revision.
6. After you move `main` by hand (`jj bookmark set main …`), run
   `node tooling/dshx/packages/dshx/dist/cli/bin.js checkout sync` (`--dry-run`
   previews). It rebases the `default` workspace with its local edits, rebuilds
   what changed and says whether DSH needs a restart; it never restarts DSH. A
   rebase does this itself.
7. The jujutsu read tools (`jj_details`, `jj_revision_files`, `jj_edit_times`,
   `jj_graph_slice`, `jj_revision_relationship`) accept a full commit id or a
   short commit/change id prefix; an ambiguous or divergent prefix gets its own
   error. Mutating actions take full ids from `jj_load` or a preview.
8. Long runs: keep a `plans/<topic>/README.md` progress table with a "Resume
   here" line; commit after each milestone. When the last task is done and
   verified, run `complete-plan`: durable content moves into the owning docs and
   the plan is deleted (see `plans/README.md`).

## Environment

Node comes from **fnm**, pinned by `.node-version`, not from Nix.

```sh
nix develop      # or: direnv allow
node -v          # must print the .node-version value
```

`dsh` needs the official Node build: Nix's `nodejs` fails at boot with
`node-addon-require-builtin unsupported`. The dev shell strips
`~/.nix-profile/bin` from `PATH` and puts fnm first. If `node -v` prints a Nix
version, fix the shell before anything else.

## Profiles

1. Profiles live in `~/.dsh/profiles/<name>/`. Registry packages:
   `dsh plugin --profile <name> add <package>`. Owned bundles:
   `pnpm profile:sync --profile <name>` (`pnpm add <path>` cannot express a
   local bundle). Read [`docs/profile-installs.md`](docs/profile-installs.md)
   before you touch a profile manifest.
2. The seed is `profiles/web/`. `scripts/profile-sync.ts` is the only
   reconciler: it seeds missing files into the writable `~/.dsh/profiles/web/`,
   applies the seed's plugin dependencies and the marked Cordis region, and
   keeps user entries and edits outside that region. A configured launcher can
   reconcile before startup; `dshx checkout sync` can run it when the seed
   changes. Assume no external machine configuration or automatic live
   deployment
   ([details](docs/profile-installs.md#the-web-profile-reconciles-itself)).
3. A seed row outside the marked region never reaches an existing live profile.
   When you fix a seed row for a DSH rename (service or prompt variable), tell
   the user the live row needs the same edit. Two 0.2.1 breakages
   (`webRuntime` → `webStartup`, the `{{cwd}}` persona suffix) stayed broken
   live this way.
4. The adopted `dsh-superagent` runs only in its own stock `superagent` profile,
   never `web` or a seeded profile. Install and operate it only through
   `node scripts/superagent.mjs` ([guide](docs/superagent.md)).
5. Experiment in a disposable `probe` profile, never the live profile. Isolate
   its home, dependencies and port from the running installation:

   ```sh
   pnpm profile:sync --profile probe
   fnm exec --using="$(cat .node-version)" pnpm profile:boot --profile probe
   pnpm --dir plugins/@dshfiles/<name> test
   # once it earns its place: add it to profiles/web/package.json; the next restart links it
   ```

6. `probe` has unrelated activation failures? Use the dshx E2E
   `bootPluginProfile('@dshfiles/<name>')` fixture: a disposable home with the
   base web bundles plus the selected bundle. Promote on measured evidence.
   Remove abandoned experiments from every profile they reached.

## DSH upgrades and recovery

Never upgrade the global `@deepseek-ai/dsh` in place. Use
`scripts/dsh-lkg/cli.mjs upgrade <version>`: it proves the new core against a
separate profile first. Recovery tooling is optional: inspect its local
configuration and private-copy behavior before you invoke `dsh-lkg`. Runbook:
[`docs/recovery.md`](docs/recovery.md).

## Writing plugins

Make every plugin configurable by default: each significant or opinionated
feature gets a setting or is independently switchable, so others can combine
dshfiles to fit their workflows. Use sensible, compatible defaults. A feature
that spends tokens, money or Host time on its own (a warning that triggers a
compaction, a background model call) ships off by default until a measurement
shows it pays for itself. Document the controls, effects and restart
requirements. No toggle for each minor detail.

New plugins use our dshx hard fork at `tooling/dshx` (`@dshfiles/dshx`;
provenance in [`FORK.md`](tooling/dshx/FORK.md)). It has no upstream remote.
Never install `@becomeopc/dshx` from a registry. Build it, then scaffold:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@dshfiles/dshx
node tooling/dshx/packages/dshx/dist/cli/bin.js create my-plugin --cwd plugins/@dshfiles --template ui --style css-modules
dshx inspect slots --root sidebar     # read the live composition instead of guessing
```

`dshx create` takes only an unscoped slug: set the package manifest and
`dshx.config.ts` name to `@dshfiles/my-plugin` before you build. Docs:
[authoring guide](tooling/dshx/docs/sdk/getting-started.md),
[compatibility](tooling/dshx/docs/compatibility.md) (check before you assume a
0.1 API exists).

1. Workspace contract (`plugins/scripts/check-workspace-contract.ts`): `build`,
   `test` and `typecheck` scripts; a `tsconfig.json` that extends the root
   `tsconfig.base.client.json` (strict, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`,
   `isolatedModules`) with no flag turned off; at least one end-to-end journey
   in the running client. Manifests name exact versions outside
   `peerDependencies`; a version two manifests share goes in the `catalog:` of
   `pnpm-workspace.yaml`. The script rejects ranges.
2. Owned plugins are Cordis bundles: `cordis.patch.yml` inserts the package row,
   `dist/index.js` is the Host half, `dist/client.js` the browser half.
3. A plugin whose catalog lists a `client` surface ships at least one screenshot
   in `plugins/@dshfiles/<name>/docs/screenshots/`, embedded under its README
   title and named after the catalog feature it walks. Refresh it (whole shot or
   the changed screen) after a significant UI change (new surface, moved
   control, restyle), never for copy. `node --run check:screenshots` fails a UI
   plugin without one; `pnpm screenshots` captures them from a scratch DSH. See
   [plugin screenshots](docs/plugin-screenshots.md). A change that adds or moves
   UI carries its screenshots in the PR description too.
4. Every UI works on a phone: check it at 390 px width with touch-sized targets
   (44 px) and keyboard-only use, and cover new surfaces in a narrow-viewport
   journey or a scratch-DSH shot.
5. A capability the user has, the Agent gets. Each user-facing capability (row
   action, dialog verb, settings write) carries an agent tool: bind the existing
   dshx method with `tool: { name, readOnly, render }`, not a second
   `defineTool` that restates it.
   1. Reads set `readOnly: true`.
   2. Write tools say in their description that they run only when the user
      asked.
   3. A destructive verb takes an explicit opt-in argument with no default, so a
      bare request cannot destroy work.
   4. Each new user-visible state transition gets a way to see the result and,
      where meaningful, to reverse or reopen it. Test both paths, or state why it
      is intentionally irreversible.
   5. Presentation-only state (tab layout, lightbox, draft) is not a tool.
   6. No native Host verb? Apply [The core boundary](#the-core-boundary).
   7. Audit and backlog: [`docs/agent-tool-parity.md`](docs/agent-tool-parity.md).
6. Host work leaves a span, and the catalog says which. Each feature in
   `dshx.features.json` lists `telemetry`: the `automatic` spans it gets
   (`api-dispatch`, `agent-tool`, `model-stream`, or the shared `jj` / `secret`
   / `multi-host` helpers), a `custom` span with the `recordSpans()` test that
   asserts it, or a `not-applicable` reason (client-only, pure functions). Host
   code that fetches, opens a socket, spawns a process or runs a long job wraps
   that unit in `withSpan`/`traced` (one span per unit, named
   `<subject> <verb>`, identities and counts only) or names its caller's span in
   `ioDelegation`. `features:check` and `dshx build` fail an addition or update
   that skips this
   ([telemetry contract](docs/observability.md#the-telemetry-contract-checked)).
7. Loader row ids share one namespace per profile: keep the scope in the id
   (`@dshfiles/shortcuts` → `dshfiles-shortcuts`). `defineSettings.namespace`
   equals that row id. One Host entry cannot declare both native `Config` and
   dshx `settings`.
8. A plugin and dshx resolve **one** `@deepseek-ai/cordis` (including
   `cordis-plugin-include` and `cordis-plugin-loader`); two copies land
   `declare module` augmentations on the wrong `Events`. Root
   `pnpm-workspace.yaml` pins the versions with `dedupePeerDependents: true`.
9. Each user-facing warning or error gives a recovery path: what the user can
   change or do next, with a direct control or exact command when available. No
   safe recovery? Explain the limitation and the next practical alternative.
   Never a dead-end message.
10. A UI plugin ships an `onboarding` block in `dshx.features.json` on its most
    user-facing feature: `firstAction` and `doneWhen`, one plain sentence each;
    `open` only for a panel, command or Settings section it really registers.
    `features:check` fails without one unless every client feature is
    `surface: infrastructure`.

### Plugin UI and state

1. Each reusable view opens from both the command palette and the New tab view
   chooser. Use one qualified destination name where a short name is
   ambiguous. Test registration, availability and removal. Contextual runtime
   occurrences are not reusable views.
2. Client UI uses `@dshfiles/plugin-ui` (shadcn/ui on Tailwind v4); the
   `plugin-ui` and `plugin-state` skills carry the workflow. Rules that break
   silently — `dshx:` utilities with `cn`, no native `title` or `<select>`,
   rebuild `@dshfiles/ui-styles` after a class change, project pickers over
   thread workspaces, multi-select only for a batchable row verb — are in the
   [kit README](plugins/@dshfiles/plugin-ui/README.md#rules-that-break-silently).
3. Repeated panel instances own their presentation state: a view, filter,
   selection, sort or layout change in one never changes another. Carry the
   stable occurrence identity through panel adapters and key persisted
   presentation state by it. Shared domain data and explicitly shared settings
   or saved views keep their owners. Test simultaneous instances and
   restoration.

### Credentials: store a reference, never a value

DSH never echoes a secret value back, so a field cannot hold one and
round-trip. Store `secret:ALIAS` (or `secret:ALIAS@env`) and resolve it on the
Host:

1. Grammar, schemas and `SecretReferenceResolver` come from
   `@dshfiles/credential-port`. Bundle it in the Host entry
   (`host.bundleDependencies`). Never restate the regex.
2. `ctx.get('secretCatalogValues').resolve({ reference, cwd })` is the only
   value read. The value never crosses to a Client. Keep an
   environment-variable fallback when the feature has one.
3. Mark a vault field with `data-secret-input="reference"` (plain HTML) or
   `Schema.string().role('secret-ref')` (settings schema). Never import the
   Catalog's picker from another plugin.
4. Contract: [docs/secret-references.md](docs/secret-references.md).
   Implementation: `plugins/@dshfiles/secret-catalog/README.md`.

### Effect in Host code

Host halves are Effect 4.1 programs. Follow the Standards table and the
[Effect guide](tooling/dshx/docs/sdk/effect.md).

1. Module paths: `effect`, `effect/process`, `effect/http`, `effect/sql`. No
   `effect/unstable/*`.
2. Patterns: `~/.references/opencode/packages/core/src` and
   `~/.references/t3code/apps/server/src`, summarized with citations in
   [the cookbook](tooling/dshx/docs/sdk/effect-cookbook.md).
3. Wrapping an unchanged Promise implementation in `Effect.tryPromise` is not a
   migration. `pnpm check:effect-native` tracks the remaining facades.

## DSH tool behavior

1. `bash` is exclusive: several `bash` calls in one turn run in sequence. Chain
   shell reads in one call (`;` independent, `&&` dependent,
   `echo "---LABEL---"` between sections) and pipe noisy output through
   `head`/`tail` inside it. Use `read` for single files: it runs concurrently.
2. For jj state, call `node scripts/jj-state.mjs` alone: `@`, working copy,
   conflicts, `main | main@origin` and the revisions above `main` in one
   process, instead of four or five `jj status` / `jj log` calls (10k+ `jj`
   calls at p50 1s logged 2026-10-15..18). `--read-only` (implies
   `--ignore-working-copy`) before you inspect another workspace; `--repo <path>`
   targets one.
3. `edit` refuses a file the native `read` never read; bash `cat`/`rg`, `grep`
   and `ast-outline` leave no receipt. After them, use `apply_patch` (atomic,
   reads first, whitespace-tolerant anchors) or `read` first.
4. `ask_user_question`'s `timeout` selects the mode. `-1` blocks until the user
   answers: only when the work cannot continue. A positive number returns
   `{ pending, callId }`, keeps the turn running, and delivers the answer later
   as a `user-question-reply`.

## Delegation and recovery

1. Substantial work: delegate independent, bounded parts to subagents when that
   improves coverage or speed, not to raise the agent count. Integrate and
   verify their results.
2. After a DSH restart or failed model request, inspect the persisted transcript
   and the workspace before you resume. Find which subagents and jobs completed,
   remain active or failed, and what they left. Continue surviving work.
   Re-dispatch only work actually stopped or lost, with non-overlapping scope.
   An interrupted parent turn alone is no reason to repeat a task.

## Waiting

Pick the channel by what you wait for:

1. Background command: `background_jobs_wait` (Host-side, no polling). A bounded
   `job_output` wait only when the job is nearly done.
2. Your parent, or a child you started: native `send_message`. A child's final
   result resumes you.
3. A thread you started with `thread_create` / `thread_fork`: `thread_prompt`
   (queue, or steer a live turn). It is a root thread, not your child:
   `send_message` refuses it with `subagent "…" belongs to another parent session`.
   Mid-turn this is not a wait: end your turn or do other work.
4. That thread's completion after your turn ends: call
   `thread_subscribe { sessionId }` first. It queues one compact notice (status
   plus answer preview) into your thread and wakes you when idle. Without it,
   nothing wakes you: a created thread is silent. `thread_unsubscribe` stops it.
5. Any other top-level thread: `thread_prompt` to start or queue its turn, or
   `dshx_comm_send` for a passive note it reads at its next prompt.
6. The user: async `ask_user_question`, or a `schedule_*` reminder. A pending
   question or the next message resumes you.
7. Thread questions: `list_thread_questions` once, with `sessionId` when known.

Cap each blocking wait at about a minute, including `job_output { wait: true }`.
DSH reads a user's steer only at the next step, so a long wait delays the steer
as long. Set `timeoutMs` from that bound. On timeout, report the job still runs
and end the turn; do not wait again in the same turn. The completion notice
resumes you.

## Verifying and done

1. A plugin that installs is not a plugin that works. Read the boot output, ask
   `dshx status` what the running instance is, and import-check the built Host
   bundle.
2. `dsh --profile web --dump-config` shows what a profile loads. A bare `curl`
   gets 401.
3. Focused checks first (`pnpm test:related`). Never the full suite by default.
4. No done claim without a fresh check: 245 "incomplete or unfixed" pushbacks
   (2026-10-15..22) came from claims without one. See `focused-validation`.
5. HMR versus restart, and the cross-plugin shape of a client boot failure:
   [docs/verifying-plugins.md](docs/verifying-plugins.md).
