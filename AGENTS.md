# dshfiles

Personal DeepSeek Harness (DSH) setup: marketplace plugins we adopt, and
plugins we own.

## Skills

Load the matching skill from `.agents/skills/` before the work it covers:

- `plugin-ui` — any plugin UI or styling; adding shadcn components to the kit.
- `plugin-state` — Query / Form / xstate / localStorage in plugin clients.
- `dsh-plugin-verify` — after changing a plugin, before saying it works.
- `jj-shared-workspace` — committing, conflicts, and long runs in the shared `@`.

## What this repo is for

Two kinds of work live here, and the distinction matters:

- **Adopting** a plugin that already exists on [dshmarket.com](https://dshmarket.com)
  (4412 plugins, 23 categories). Preferred whenever something already covers the
  need — a maintained community plugin beats a thin one we maintain.
- **Owning** a plugin that does not exist anywhere. Justified when a capability
  is genuinely unclaimed, not merely inconvenient to find.

Reference material we have ported from lives in `../bb-plugins`. It is a
**source of ideas and working code, not a spec** — DSH has different APIs,
different boundaries, and a different plugin model. Do not assume that project's
architecture carries over, and do not carry its product names into ours: our
plugins are named for what they do here. Read its `README.md` for the
*behavior* worth keeping, then reimplement against the DSH API.

### When no plugin covers the need

Adopting is the default, not a mandate. When the survey finds nothing that
covers what we actually want, do not stall, and do not settle for a plugin
that covers part of it. Pick one of these three and say which:

1. **Adopt anyway** — good enough, or the gap is cosmetic.
2. **Fork or port** — an existing project already does the hard part. Preserve
   its license and source provenance, then vendor the code inside this repo.
   Keep an upstream remote only when ongoing sync is an explicit goal. A hard
   fork has no remote dependency, remote bookmark, fetch, or rebase workflow.
3. **Build it with dshx** — from scratch, when a fork would carry more debt
   than the feature is worth.

Two rules make the choice cheap to revisit:

- **Verify against the installed runtime, not the README.** A plugin's claims
  are not evidence. Read its peer ranges against our DSH version, resolve the
  imports it actually uses, and read the Service contract it calls. Peer ranges
  are usually honest: a plugin capped below our version is a real signal.
- **Check whether the Host can do it at all before building UI for it.** Read
  the Service and Event contracts first. If the seam has no such method — no
  `reorder`, no `remove` — a plugin cannot add one, and the honest answer is a
  Host change, not a clever client-side fake. Say so instead of shipping
  something that mutates durable state to work around it.

Report which option you chose and why. A fork nobody asked for is a liability;
a workaround nobody flagged is worse.

Do not stop at "dshx cannot express this". When the same wall shows up in one
plugin, it is a missing abstraction rather than a one-off, so fix it in the
toolchain first and let the plugin become ordinary: a change that removes a type
cast, a hand-restated interface, or a workaround from every future plugin belongs
in dshx. Reach for that before writing the second workaround. Keep it narrow — an
abstraction that serves one caller is not one — and say which plugin forced it, so
the next reader knows it was earned.

A workaround is also a bug report about the toolchain. Two we shipped here were
caused by dshx gaps and were invisible until the second one hurt: a declaration a
UI plugin had to restate, and a `@deepseek-ai/*` dependency that resolves a second
copy and fails only at boot. Both are now dshx's to refuse. When you catch
yourself reaching for `as unknown as`, a local `declare module`, or a duplicated
interface, ask which layer should own it before shipping the escape hatch.

## Never restart the running DSH instance

The web profile runs on `127.0.0.1:3080` and the user is almost always using it,
often with other agents mid-turn. Never `kill` it, and never restart it to pick
up a plugin change: a restart drops every in-flight turn and can kill sessions
other agents are actively working in. Reloading the live instance is the user's
decision.

Verify a change on a **second instance on another port** instead:

```sh
dsh web --port 3199 --no-open
```

Give it a scratch `DSH_HOME` when the change touches stored state (accounts,
usage history, plugins), so the second instance cannot rewrite the real one:

```sh
DSH_HOME=/private/tmp/dsh-verify dsh web --port 3199 --no-open
```

Report what the second instance shows, then let the user decide when to restart
the real one. Test against the running application — but never by restarting it.

## Never delete source while a build is serving

A plugin's `dist/` keeps working after its sources are gone, so deleting a file
under a running build looks like a no-op until the next rebuild — which is how a
whole plugin can be missing for hours while the served bundle still answers.

Before removing a source file: confirm it is tracked, and confirm nothing serves
it. When recovering, `jj file show -r <change> <path>` restores a file from any
revision, which is faster and safer than rewriting it. Verify the build afterwards
by importing the built entry, not by looking at it.

## Git

This is a [Jujutsu](https://jj-vcs.github.io) repo, colocated with git.

- `jj status` before starting; `jj diff` to review; `jj describe` then `jj new`
  for a change only when `@` holds nothing but your work. Never `git`-only commands, never `jj git push` without asking.
- The working copy is always a commit — there is no separate staging area.
- Shared checkout: if another agent's files are in `jj status`, they are not
  yours. Commit only your own paths with `jj split -m "…" <paths>` (one
  described revision per logical change, `Co-Authored-By` trailer); check
  `jj log -r 'conflicts()'` after rebases. Skill: `jj-shared-workspace`.
- Long runs: commit and tick the plan's checkboxes after each milestone, and
  keep a `plans/<topic>/README.md` progress table with a "Resume here" line.

### T3 threads and JJ workspaces

- This repository uses one shared JJ store. Parallel checkouts created with
  `jj workspace add` may sit beside the repository directory; they are still
  linked and versioned when `jj workspace list` shows them.
- For independent code work, create a named workspace from this repository,
  based on the intended local revision:

  ```sh
  jj workspace add /Users/astahmer/dev/dshfiles-<topic> --name <topic> -r main
  ```

- Before editing code in another repository, inspect its `jj root` and
  `jj git remote list`. `jj workspace list` is scoped to one JJ store. DSH core
  changes under `packages/**` belong in the canonical
  `deepseek-ai/deepseek-harness` checkout (origin:
  `https://github.com/deepseek-ai/deepseek-harness.git`); create a named
  workspace in that existing store, not an ad-hoc clone, and record its root
  and workspace path in the handoff.
- Before editing, verify `jj root`, `jj status`, and `jj workspace list` from
  that path. Record the T3 thread ID, workspace name, and absolute path in the
  task handoff. Do not use an ad-hoc copy or a T3-generated project directory
  as a code checkout.
- Create the JJ workspace before launching an independent top-level T3 thread.
  Keep the thread in this dshfiles project (`workspaceStrategy: { type: "root" }`)
  and put the workspace name and absolute path in its task message. T3's
  `existing_worktree` strategy is Git-worktree-oriented; do not pass it a JJ
  workspace path unless `t3_worktree_status` confirms that exact path and
  `jj root` confirms it belongs to this shared JJ repository. Do not use a
  scratch thread or an unlinked project directory for repository code.
- Run every edit and JJ command from the named workspace path. T3 metadata does
  not record a plain JJ workspace, so record the T3 thread ID, JJ workspace
  name, and absolute path in the task handoff, then verify `jj root`,
  `jj status`, and `jj workspace list` from that path before editing. Treat
  `branch: null` / `worktreePath: null` in T3 metadata as unbound, not as proof
  that the thread inherited a sibling workspace. If using a T3-managed Git
  worktree, first verify with JJ that it shares this repository.
- Keep active source workspaces untouched during consolidation. Duplicate a
  fixed revision snapshot into an integration workspace, rebase that copy onto
  `main`, and retain the source workspace until tree equality and status prove
  it safe to forget.

### Required integration closeout

Every completed consolidation must reduce its own JJ noise in the same task.
Record completed work, exact remaining gates, source commit IDs, tree-preservation
proof, and the recovery operation in `docs/unification-status-2026-10-07.md`.
After moving `main` and making default an empty child, forget accounted-for,
finished workspace registrations and delete temporary integration bookmarks.
Retain physical source directories, one recovery bookmark per source tip, and
an inventory of removed targets. Keep active writers and unrelated refs intact.
Do not create a permanent bookmark for every attempted rewrite. Validation
failures remain explicit in the ledger; history cleanup does not imply release
or live-profile acceptance.

## Environment

Node comes from **fnm**, pinned by `.node-version`, not from Nix.

```sh
nix develop      # or: direnv allow
node -v          # must print the .node-version value
dsh web
```

**`dsh` must run on the official Node build.** Nix's `nodejs` package fails at
boot with `node-addon-require-builtin unsupported: Unsupported/no-getter`
because DSH's native loader probe cannot find its internal getter on the Nix
build. `mkShell` puts `~/.nix-profile/bin` ahead of fnm's directory in `PATH`,
so the `shellHook` strips that entry and re-prepends `FNM_DIR/bin`. If `node -v`
prints a Nix version, the shell is misconfigured — stop and fix it before
debugging anything else.

## Installing plugins

Profiles live in `~/.dsh/profiles/<name>/`. Registry packages go through
`dsh plugin --profile <name> add <package>`; owned bundles go through
`pnpm profile:sync --profile <name>`, because `pnpm add <path>` cannot express a
local bundle. `docs/profile-installs.md` has the pnpm and peer-dependency traps
behind that rule; read it before touching a profile manifest.

The checked-in web profile seed lives in `profiles/web/`. Home Manager reads
it from `$HOME/dev/dshfiles/profiles/web` and seeds missing files into the
writable `~/.dsh/profiles/web/` profile. On apply, it reconciles the plugin
dependencies and marked Cordis region. Active DSH files remain writable;
runtime edits outside that marked region stay local to the profile.

### Experiment in a scratch profile, promote on evidence

Do not register a plugin in `~/.dsh/profiles/web/` to try it out. The `web`
profile is the one every session runs; an experiment that boots badly, changes
tool behavior, or turns out not to be worth it then has already contaminated the
setup you actually use.

`~/.dsh/profiles/probe/` exists for this and is deliberately **not** Nix-managed,
so nothing in the Nix setup can pull an experiment back in. It has its own
`node_modules` and its own port lifecycle.

```sh
# 1. write the plugin in this repo, under plugins/@dshfiles/<name>/
# 2. verify it without touching web
pnpm profile:sync --profile probe
fnm exec --using="$(cat .node-version)" pnpm profile:boot --profile probe
# 3. benchmark against the default it claims to beat
pnpm --dir plugins/@dshfiles/<name> test
# 4. only once it earns its place
pnpm profile:sync --profile web
```

`dsh web` binds `127.0.0.1:3080` **once per profile**, so `web` and `probe` can
run side by side — the second boot gets its own port and its own tokenized URL.
`profile:boot` stops the server it starts.

Promote on measured evidence, not on the idea sounding right. A plugin that
cannot state the number it improves is not ready for `web`. When the experiment
is abandoned, remove it from `probe` — and if it was ever added to `web`, remove
it from there too.

## Writing our own plugins

New plugins use our dshx fork (TypeScript, React, Vite). From the repository
root, after building it:

```sh
node tooling/dshx/packages/dshx/dist/cli/bin.js create plugins/@dshfiles/my-plugin
cd plugins/@dshfiles/my-plugin
pnpm dev                              # client HMR + host auto-restart
dshx inspect slots --root sidebar     # read the live composition
```

Its typed surface is a strong default, not a guarantee. Its most reliable value
is `dshx inspect` — read the real runtime instead of guessing whether a slot or
service exists. Every plugin joins the workspace contract
(`plugins/scripts/check-workspace-contract.ts`): `build`, `test` and
`typecheck` scripts, `strict` and `noUncheckedIndexedAccess`.

### Plugin UI and state

Client UI uses `@dshfiles/plugin-ui` (shadcn/ui on Tailwind v4), not hand-rolled
components or local Tailwind setups. Skills `plugin-ui` and `plugin-state` hold
the details; the rules that break things silently:

- Every utility is `dshx:`-prefixed, written as a complete static string, merged
  with `cn`; `dshx-root` on each surface root; semantic colors only.
- After **any** class change in **any** plugin, rebuild every plugin that
  depends on plugin-ui, or the shared stylesheet stops deduping and variants
  get overridden.
- Host/async data → `/query`, multi-field forms → `/form`, tangled flows →
  `/machine`, localStorage → `createStoredValue`. See
  `plans/plugin-state-audit.md`.
- Prefer Host utilities (`relativeTime`, `writeClipboard`, `rankByName` from
  `@deepseek-ai/dsh-client-ui-primitives`) over local copies.

### We maintain a local dshx hard fork

The complete source lives at `tooling/dshx`, inside this repository's single
Jujutsu/Git boundary. It is a maintained hard fork for DSH 0.2 compatibility;
the original package peer range did not claim DSH 0.2, and reimplementing its
build and inspection tools would duplicate useful work.

The fork is owned here as `@dshfiles/dshx`. It must not fetch or install
`@becomeopc/dshx` from a registry, and it has **no upstream remote at all**.
Upstream went quiet for about a month and did not support the DSH generation
this profile runs, so waiting on it cost more than owning the divergence. Do not
add an upstream remote or bookmark, fetch, or merge. `tooling/dshx/FORK.md`
records the source baseline, license, and attribution. Do not add a nested
`.jj`/`.git`; review DSH changes manually when the native contracts move.

Plugins link the local path, so the CLI a plugin builds with is always this tree.

```sh
cd tooling/dshx
pnpm install --frozen-lockfile
pnpm --filter create-dshx build    # the CLI imports it, so it builds first
pnpm --filter @dshfiles/dshx build
```

The fork's own documentation is the source of truth for what it does:
`tooling/dshx/docs/sdk/getting-started.md` for the authoring API,
`tooling/dshx/docs/compatibility.md` for what a DSH generation changed, and
`tooling/dshx/FORK.md` for provenance. There is no separate plan for it here —
a plan that outgrows the code it describes is a second source of truth, and it
goes stale silently. Check `compatibility.md` before assuming a 0.1 API still
exists.

Two cordis copies are the failure mode that makes this look like a dshx bug. A
`declare module` augmentation lands on the `Events` of the copy that is
resolved, so a plugin and the toolchain typing it must share **one** cordis
identity — including its `cordis-plugin-include` and `cordis-plugin-loader`
versions, which are part of the identity. Verify with:

```sh
node -e "const{createRequire}=require('module');\
const r=createRequire('$PWD/src/x.ts');\
console.log(r.resolve('@deepseek-ai/cordis').split('.pnpm/')[1])"
```

If those disagree, pin the versions and add `dedupePeerDependents: true`.

Owned plugins are plain cordis bundles: a `cordis.patch.yml` that inserts the
package row, `dist/index.js` for the host half, `dist/client.js` for the browser
half. That part is stable regardless of which build tool produced it.

Top-level Loader ids share one namespace across every bundle in a profile.
Keep a package's scope in its inserted row id (`@dshfiles/shortcuts` becomes
`dshfiles-shortcuts`); using only the package leaf can silently replace the
profile's index for a native row. A dshx `defineSettings.namespace` must equal
that row id, and one Host entry cannot declare both native `Config` and dshx
`settings`. DSHX scaffolds preserve the scope, and profile
inspection runs DSH's offline `--dump-config` composition check before plugin
development or a runtime check so duplicate top-level ids fail before boot.
Point an owned plugin's `dshx.config.ts` at `profile: 'vanilla'` when debugging
it without the rest of the adopted plugin set.

Creator mode (DSH's in-app plugin authoring preset) is not declared on this
profile; `docs/creator-mode.md` says how to check and where its skills live.

## Shell command batching

The `bash` tool is **exclusive**: the scheduler serializes it against every other
tool call, so N `bash` calls in one assistant turn run one after another. Only
tools that declare `isConcurrencySafe` join a parallel group — currently `read`,
`read_image`, `web_search`, `web_fetch`, `subagent`, and `subagent_fork`.
`glob`, `grep`, `write`, and `edit` are **not** concurrency-safe; each falls back
to the exclusive path.

Independent shell reads belong in **one** call, chained:

```sh
# bad: 3 tool calls, each paying the exclusive barrier
jj file show -r @ a.ts
jj file show -r @ b.ts
diff -u /tmp/base.a a.ts

# good: 1 tool call, 1 process
jj file show -r @ a.ts > /tmp/base.a && jj file show -r @ b.ts > /tmp/base.b
diff -u /tmp/base.a a.ts; diff -u /tmp/base.b b.ts
```

- `;` separates independent commands, `&&` chains dependent ones.
- Put `echo "---LABEL---"` between sections when output needs attribution.
- Pipe noisy commands into `head`/`tail` **inside** the same call, never in a
  second call.
- Prefer `read` for single-file lookups: it is concurrency-safe and never hits
  the barrier. `glob` and `grep` do not, so batch them inside one `bash` call
  when you have several to run.
- Reserve several `bash` calls for work that genuinely must be separate, and
  accept the serialization.

Measured over 37 sessions of this repo's own history: 93.8% of steps already
issued a single tool call, and 66% of the multi-call steps that did contain bash
were already gated by bash being the slowest call — so parallelizing bash is
worth less than batching it.

## Verifying anything

A plugin that installs is not a plugin that works.

- **Read the boot output.** `dsh web` prints one line per entry that failed to
  activate, plus the tokenized URL. That line is the whole signal — check it
  every time.
- `dsh web` binds `127.0.0.1:3080` and answers **401** to a bare `curl`. The
  usable URL is the tokenized one it prints at startup. Never conclude a plugin
  is broken from a 401 alone.
- Startup failures that are fatal write a diagnostic under
  `~/.dsh/logs/startup-*.log`. Non-fatal "did not activate" warnings do **not**
  — they only appear on stdout. Capture stdout.
- Only `http://127.0.0.1:3080` may be started once per profile. A stale process
  holding the port produces `EADDRINUSE` and masks the real error; check
  `lsof -nP -iTCP:3080 -sTCP:LISTEN` before debugging a boot failure.
- Prefer `dsh --profile web --dump-config` over reading installed plugin source
  to learn what a profile actually loads.

### Rebuilt plugins reach the browser over HMR

`dsh web` does **not** need a restart to pick up a rebuilt plugin.
`@deepseek-ai/dsh-client-hmr` is in the default web profile; it polls each
bundle's `mtime`/`ctime`/`size` every 500ms and pushes an SSE `graph` frame on
`/plugins/events`, which the client applies without a reload. Verified on a live
instance: rebuilding `dist/client.js` produced a fresh graph frame within one
poll interval.

What a page refresh alone does **not** do is re-read the boot manifest. The
bundle `rev` is a content hash computed when the server started, so a running
server keeps serving the manifest it booted with. Confirmed by editing a served
bundle twice on one server and reading the same `rev` back both times.

So the workflow is: rebuild, let the client receive the graph frame, and only
restart when the change is to `cordis.patch.yml`, `package.json`, host code, a
settings namespace, or the profile composition — anything the server resolves
at boot rather than per request. That restart is the user's call.

Until then the live DSH runs the **old host** under the **new client**. Clients
must tolerate it: decode Host snapshots once at the boundary with defaults,
never assume a new field or method exists, and fall back to defaults when the
settings namespace is unregistered — never throw. After every build,
import-check the host bundle with the DSH Node
(`fnm exec --using=22.23.3 node -e "import('./dist/index.js')"`); a failure there
is a "did not activate" at boot. Full checklist (probe/scratch profiles,
`plans/optmem/tools/drive.mjs`, console checks, perf budget in
`plans/ade/perf-baseline.md`): skill `dsh-plugin-verify`.

### Client boot failures are cross-plugin

A `Failed to load plugins` card lists symptoms, not causes. The entry named first
is frequently not the broken one: a plugin that throws during `apply` is the
cause, and the entries listed as `pending (waiting for service: X)` are innocent
dependents of the service it failed to publish. Fixing the failed entry is the
only thing that clears the pending ones.

`dshx check` and `tsc` both pass on a plugin with a colliding locale namespace
or a missing runtime service, because both are defects only visible across the
installed set. See `plans/plugin-boot-integrity.md`.
