# Project onboarding, the way t3code does it

Open. Compared 2026-11-07 against our `main` at `1eebe26d` and
[pingdotgg/t3code](https://github.com/pingdotgg/t3code) at tag
`v0.1.8-nightly.20261104.4179` (commit `9e85538`, 2026-11-04). t3code paths below are
relative to that tag; our paths are relative to this repository.

This plan supersedes the C6/C7 detail in [t3code parity](t3code-parity.md), which marks
"local clone and new project" done. Both shipped on 2026-10-29 — the clone and the new
project exist — but onboarding an **existing folder** was never wired to any of it.

## Why this plan exists

The 2026-10-31 thread (Improve Project Setup and jj Initialization) reported the real
gap: cloning by hand in a terminal, then adding the folder, then finding **no branch and
no workspace control** in the composer. Adding a folder still only registers a directory:

- `project_register` (`plugins/@dshfiles/thread-sidebar/src/thread-actions.ts`) calls the
  native register callback and stops. No repository detection, no jj, no bookmark.
- The Add-workspace flow (`plugins/@dshfiles/workspace-folder-picker/src/client.tsx`)
  browses folders in `directories` mode with a **New** menu holding Clone and New project;
  choosing a folder submits it through `onRegisterWorkspace` / `onPicked`, nothing else.
- The only code path that enables Jujutsu for an existing Git checkout is the graph client
  (`plugins/@dshfiles/jujutsu/src/repository-opening.ts`, called from
  `plugins/@dshfiles/jujutsu/src/client.tsx`). `RepositoryInitializer`
  (`plugins/@dshfiles/jujutsu/src/repository-init.ts`) and the `jj_open_repository` tool
  already do the guarded init: plain folders and nested Git boundaries are refused, broken
  `.jj` is never repaired, concurrent opens queue.
- Nothing in `plugins/@dshfiles/jj-integration` renders a "this project is not a Jujutsu
  repository" state, so the composer simply shows no Workspace segment.

The controls are not missing. The **onboarding step that would make them appear is.**

## What landed since that thread (2026-10-31 → 2026-11-07)

717 commits on `main`; these are the ones touching project/workspace surface. None of them
changed folder → project detection.

| Date | Commit | What it did for project setup |
| --- | --- | --- |
| 11-04 | `00fda92f` | Absorbed the project folder picker component into this bundle |
| 11-04 | `376e58c0`, `d56cf1b6`, `6276680f` | New-thread label, catalog rules, published tool arguments |
| 11-05 | `85f4c426`, `22c41a57` | Thread-workspace VCS port with jj **and git** adapters; git-only repos served through the jj tools and UI |
| 11-05 | `954a221c` | Automatic fetch for git-only repositories |
| 11-05 | `5267075a`, `8c94a899` | Hardened git thread-workspace adapter; bounded reads |
| 11-05 | `28d2ac29` | pulls-review reviews git-only thread workspaces |
| 11-07 | `411a9890` | Windows paths + native folder dialog in the picker (PR #55) |
| 11-07 | `471bc0b9` | Clone job tracked by state, one admission per destination |
| 11-07 | `f79cd993` | Picker path query and browse target in one reducer |
| 11-07 | `951d4ae0` | Add-workspace pick flow is one state union |
| 11-07 | `1c93a99d`, `a0700b1b` | Duplicate/ambiguous jj workspace destinations fixed |
| 11-07 | `67972b66` | `multi_host_checkout_sync` |

Shipped just before that thread (2026-10-29), so it was already on screen but still not
wired to folder registration: clone with progress and cancel (`c4cd3b0d`), new project with
`jj git init --colocate` + README + first commit + `main` bookmark + optional private
GitHub repo (`7f5509e5`), `jj-integration` auto-fetch (`3d65bd68`), Host-owned auto-settle
(`73cda290`).

## How t3code does it now

**1. One entry point, several sources.** Add Project (palette or empty state) asks for the
machine, then offers `New project`, `Local folder`, `Git URL`, and one row per hosting
provider with a **Setup Required** badge when that provider has no credential
(`apps/web/src/components/CommandPalette.tsx`, `buildAddProjectSourceGroups`). Cloning goes
through the provider API when available, so it can show `owner/repo` before and during the
clone.

**2. The project exists before the files do.** `ProjectCloneTracker`
(`apps/server/src/project/ProjectCloneTracker.ts`) resolves the remote, creates the project
pointing at the empty destination, then starts `git clone` detached from the request. The
palette closes immediately, every client can hold a draft, and a toast tracks the clone
(`apps/web/src/components/ProjectCloneToastCoordinator.tsx`, streaming snapshots from
`packages/contracts/src/projectClone.ts`). Sending before the files land is refused centrally
(`rejectCommandsDuringClone`), so no transport can start a thread on an empty tree.

**3. Stages, retry, cancel, and a durable failure.** Git's own clone stages
(`connecting`, `counting`, `receiving`, `resolving`, `checkout`) are parsed with a percent
and a detail line. `cancel` interrupts and deletes the partial checkout, `retry` restarts into
the same destination, and a failed clone **keeps the project** because the empty project is
the thing the user can act on. Finished snapshots are dropped after 30 s; failures stay until
retried or removed.

**4. New project from just a name.** `ManagedProjectFolders`
(`apps/server/src/project/ManagedProjectFolders.ts`) claims `<namedProjectsRoot>/<slug>`
with `-2`, `-3` on collision, writes a README and a generated monogram `assets/icon.svg`,
makes the first commit, and keeps the project with a `commitError` when Git has no identity
or signing fails. The folder is removed only when creation fails before a project owns it.

**5. Publish an existing repository.** A local repo without a remote gets a hosted
repository, `origin`, and its commits pushed (`docs/user/source-control.md`,
"Start, clone, or publish a project").

**6. A checked-in project file that is safe by construction.** `t3.json` at the workspace
root (`packages/contracts/src/t3ProjectFile.ts`) declares `iconPath`,
`defaultThreadEnvMode`, `worktreeSubmodules`, and `scripts`. Non-executable settings are
**file-backed**: resolved project override → environment → `t3.json` → built-in. Scripts
never run from the file; they are imported into the project's stored settings first
(Settings → Project → Actions, `apps/web/src/components/settings/ProjectActionsSettings.tsx`).

**7. Setup runs where the thread starts, and you can watch it.** `ProjectSetupScriptRunner`
runs a stored `runOnWorktreeCreate` script inside the new worktree. `async: false` holds the
agent until it exits; the default starts the agent while it runs. `WorktreeSetupTracker`
(`apps/server/src/project/WorktreeSetupTracker.ts`) publishes live stages with a cancellable
progress card until the first turn is dispatched, then becomes uncancellable.

**8. Project identity, not just a path.** `RepositoryIdentityResolver` (15 min positive /
1 min negative cache) derives the remote, forge and canonical repository key;
`ProjectFaviconResolver` probes ~23 icon paths and 7 source files (cached);
`ProjectEnrichmentService` fans both out with bounded concurrency and publishes changes.
Checkouts of one repository group as one logical project with per-environment badges.

**9. Policies that run on the server.** Automatic worktree cleanup (inactivity, merged, no
commits beyond the default branch) with protection tiers for uncommitted/untracked/ignored
files, delete-with-thread, and a report naming why each worktree was kept. Auto-pull
fast-forwards the default-branch checkout only when it is clean and has no local commits.
Worktree location and branch naming are settings, overridable per project.

**10. Agent parity.** `t3_project_list/read/create/update/delete/clone` and
`t3_thread_launch` (`apps/server/src/mcp/toolkits/project/tools.ts`) mirror the UI verbs;
`t3_thread_launch` refuses a workspace root that is not one of the project's own worktrees.

## Where we stand

| Dimension | t3code | Ours today | Verdict |
| --- | --- | --- | --- |
| Entry point | Add Project → machine → source (`New project` / `Local folder` / `Git URL` / provider) | Add workspace → browse; **New** menu holds Clone and New project | Ours hides the three verbs and offers no provider source |
| Folder state | Repository identity resolved on add (remote, forge, icon) | Nothing inspected; a plain folder, a Git checkout and a jj repo all look the same | **Main gap** |
| Enable Jujutsu | n/a (git-first) | `RepositoryInitializer` + `jj_open_repository` exist but only the graph client calls them | Verb exists, onboarding does not |
| Composer after add | Env mode (local/worktree) chosen per project, remembered | Workspace/bookmark segments appear only when the folder is already a jj repo | Complaint still reproducible |
| Clone | Project first, files later, draft allowed, send gated, toast on every client | Folder cloned, then jj colocated, then registered; dialog-local progress; no other surface | Project appears only on success |
| Clone failure | Partial checkout deleted, project kept, **retry** into the same destination | Partial folder deleted, failure text only, **no retry** | Retry is missing |
| Clone progress | Stage + percent + detail, repository `owner/repo` | Last stderr line parsed to percent + message | Close enough; add stages |
| Publish repository | Publish Repository for a local repo without a remote | Only as a checkbox in New project (`gh repo create`) | **Missing** for existing checkouts |
| Project during clone | Created immediately, empty root is a valid record | Created after the clone | Decision needed (native send path) |
| Checked-in project config | `t3.json`: icon, env mode, submodules, scripts (imported) | None | **Missing** |
| Scripts on workspace create | `runOnWorktreeCreate`, `onSettle`, async flag, progress card | `project-checks` runs profile-trusted actions **manually**; nothing runs on workspace create | Plan-time gap, safe by design |
| Project settings overrides | project → environment → file → built-in, with a layers UI | Only global plugin settings; no project tier anywhere | **Missing** |
| Project identity | Identity + favicon + grouping + badges | `multi-host` groups remote threads by repository origin; no project icon | Partial |
| Cleanup | Inactivity / merged / no-commits, protection tiers, report, delete-with-thread | `autoCleanup` kinds `empty`/`integrated`/`untracked`, `olderThanHours`, `onSettle`, `removeFinishedThreads` | Close; no merged kind, no protection tiers, no reasons report |
| Auto-pull | Fast-forward the checkout when clean | `autoFetch.fastForwardBookmark` on `main` (off by default), `syncWorkspaceAfterLand` | Ours moves a bookmark, not the checkout — acceptable for jj |
| No-project threads | `~/.t3/scratch/<date>-words-id`, promoted by **Turn into project** | `No folder` workspace (`~/.dsh/no-folder`), no promotion | Small gap |
| Agent tools | `t3_project_*`, `t3_thread_launch` (worktree-bound) | `project_list/register/rename/delete/reorder`, `project_clone*`, `project_create`, `jj_open_repository` | Parity except inspect/publish/retry/config |

## What they do better, ranked

1. **Folder → project is an inspected onboarding, not a registration.** They resolve what
   the folder *is* (repository, remote, forge, icon, env default) at add time and put the
   choices in front of you. We register bytes on disk and let the composer look empty.
2. **Clone is project-first.** The project and its draft exist while the clone runs, the send
   is refused with a reason instead of racing an empty tree, and progress is a stream every
   client can render.
3. **Failure is recoverable in place.** Retry into the same destination, keep the empty
   project, delete only the partial checkout. We throw the folder away and lose the intent.
4. **Publish closes the other half of the loop.** New project can create the remote; an
   existing local repo can also publish, which is the common case for someone who ran
   `git init` locally.
5. **A checked-in project file with a sharp trust boundary.** Declarative settings apply
   directly (safe); commands must be imported first (safe). We have the trust stance in
   `project-checks` but no file, so a cloned repo cannot declare anything about how it wants
   to be worked in.
6. **Setup is a visible stage of starting a thread.** Worktree create → submodules → setup
   script, with a cancellable card. We warm a jj workspace
   (`plugins/@dshfiles/jj-integration/src/thread-warmup.ts`) but never run the project's own
   "make this checkout usable" step.
7. **Project identity is derived once and cached.** Icons, remote, grouping and badges are
   enrichment, not per-render work. We show titles and paths everywhere.
8. **Settings have a visible inheritance chain.** One control, one layers popover, project
   overrides counted and resettable. Ours are global-only, so "isolate new threads **in this
   repo**" needs a settings file edit.
9. **Cleanup explains itself.** Every kept worktree says why (local changes tier, active
   session, shared checkout). Ours silently keeps.

## What we keep (do not trade away)

- **Guarded repository init.** Plain folders, nested Git boundaries and broken `.jj` are
  refused; jj is never enabled implicitly. t3code has no analogue and no equivalent risk.
- **jj-first isolation.** Per-thread workspaces, Land/integrate onto `main`, conflict checks.
  t3code's worktree model is Git-only, so its `worktreeSubmodules` and `dirty` tiers do not
  map onto a jj workspace.
- **Profile-trusted actions.** `project-checks` never runs repository-controlled commands.
  t3code's `t3.json` scripts auto-run on worktree create; we should not adopt that, and the
  plan below keeps the import step.
- **One Host, many machines.** `multi_host_clone_project` and `multi_host_checkout_sync`
  already cover what t3code splits across environments.
- **Agent parity by construction.** Every dshx method carries its tool; `jj_open_repository`,
  `project_clone`, `project_create` already exist to be reused rather than reimplemented.

## Phases

### P1 — Inspect a folder and offer Jujutsu (highest leverage)

Goal: adding an existing folder tells you what it is, and one click gives you the composer
controls you were missing.

- [x] Add `projectInspect` to `@dshfiles/workspace-folder-picker` (read-only, tool
      `project_inspect`): resolve the folder's real path, then report
      `{ kind: 'none' | 'git' | 'jujutsu', repositoryRoot, remoteUrl, bookmark, workingCopy,
      nestedGitBoundary, brokenJjMetadata, canEnableJujutsu, reason }`. Reuse
      `registerRepositories` from `@dshfiles/jujutsu` for jj detection instead of a second
      marker check, and `git rev-parse --show-toplevel` / `git remote get-url origin` through
      the existing `ProjectCommands` service.
- [x] Show the result in the picker row and after selection: one line, the repository state;
      an **Enable Jujutsu** button when `canEnableJujutsu`, calling the existing
      `jj_open_repository` (`openGraphRepository` already wraps old-Host fallback). Never
      initialize without that click; remember the answer per folder for the session.
- [x] For `kind: 'none'`, offer **New project in this folder** (P1 uses the existing
      `project_create` path semantics) instead of a dead end.
- [ ] Wire the same inspect into `project_register` (`thread-sidebar`) and the New-thread
      picker registration so no surface registers blind; the `project_register` tool
      description gains one line about what it does **not** do.
- [ ] Give `jj-integration` a non-repository state on the composer/destination bar: "Not a
      Jujutsu repository — Enable (or `jj git init --colocate`)" with the same action.

Acceptance: adding a plain folder, a Git checkout, a colocated jj repo and a repo with a
broken `.jj` each produce the right state; only the Git checkout offers Enable; enabling
makes the Workspace segment and bookmark appear with no reload; a flat folder offers New
project.

Verification: unit tests over fixtures (plain, git, colocated jj, nested git, broken `.jj`,
Windows drive path) in `workspace-folder-picker`; one `dshx` E2E journey that adds a Git
checkout, enables Jujutsu, starts a thread and asserts an isolated workspace.

### P2 — A clone that survives

Goal: the clone owns its progress, its failure and its retry, on every client.

- [x] Parse git's stages (`connecting`/`counting`/`receiving`/`resolving`/`checkout`) into
      `CloneJob.progress` alongside percent and detail, so a client renders the same summary
      t3code does; derive the display name from the URL (`owner/repo`) until the folder exists.
- [x] Add `projectCloneRetry` (tool `project_clone_retry`) reusing the same destination and
      the same admission lock; a failed job keeps its path and error until retried, cancelled
      or pruned.
- [ ] Keep the failed clone's intent: do not delete the whole folder when the failure is
      after checkout started; delete only what git left incomplete, and say the exact command
      that finishes it (today's message already does this for `jj git init`).
- [ ] Surface clone jobs outside the dialog: poll `project_clone_jobs` from the sidebar
      project row (or an Activity Timeline projection) so closing the dialog does not hide
      the clone.

Acceptance: cancel → no folder, no job; failure → text + Retry; retry → same destination,
one admission; success → project selected and jj colocated.

Verification: `workspace-folder-picker` unit tests over the job state machine
(`project-lifecycle.ts`, `project-lifecycle.test.ts`) plus a fixture git server or an
unreachable URL for the failure path; E2E journey: clone a local `file:///` repo, cancel,
retry, assert project row.

### P3 — Publish an existing repository

Goal: a local checkout without a remote can get one without leaving DSH.

- [x] Add `projectPublish` (tool `project_publish`, `visibility` required, no default):
      detect no remote → `gh repo create <name> --private --source . --remote origin` → push.
      For a jj repo push the bookmark with `jj git push --bookmark <bookmark>` after adding
      the remote; refuse when the repo has no commits, naming the first commit as recovery.
- [ ] Reuse it from the New project dialog instead of its inline `gh` call, and surface it in
      the project row menu when `origin` is absent. (open: no shared project row menu yet)

Acceptance: a fresh `git init` folder with one commit gains `origin` and a pushed `main`; a
jj repo pushes its bookmark; a repo without commits refuses with the exact next command.

Verification: unit tests with a fake `gh` on PATH (the `ExecutableLookup` seam already
exists) and one E2E journey against a scratch `gh` shim.

### P4 — A checked-in project file (`dsh.project.json`)

Goal: a repository can declare how it wants to be worked in, safely.

- [ ] Define the schema in a dshx module (`@dshfiles/workspace-folder-picker/project-config`,
      published `exports` subpath, per the repository contract): `iconPath`,
      `defaultThreadWorkspace: 'isolated' | 'shared'`, `bookmark`, and `checks` — ids of
      **trusted** `project-checks` actions to offer in this repo, never commands to run.
      A command may only live in the file as an *importable* suggestion
      (`scripts: [{ name, command, hint }]`) that the user imports into the trusted profile
      with one click; the Host refuses to run anything from the file directly.
- [ ] Resolve it at the workspace root, validate with the published schema, and treat a
      missing or invalid file as absent (log once, never fail a thread).
- [ ] Wire `defaultThreadWorkspace` into `jj-integration`'s isolation decision for that
      repository (it already has `isolateByDefault` / `autoIntegrationScope` and a
      `RepositoryAutoIntegration` exclusion list; the file becomes another resolver in front
      of the profile setting).
- [ ] Show a read-only **Project** section (Settings) listing the file's declared values, the
      tier that won (project → profile → file → built-in), and the import button for scripts.
      This is the first project-scoped tier we have: keep it to file-backed, non-executable
      keys and say so in the UI rather than building a general override store.
- [ ] Agent tools: `project_config_read` (read-only) and `project_config_import` (write, only
      when asked) over the same Host methods.

Acceptance: a repo declaring `"defaultThreadWorkspace": "isolated"` starts isolated threads
even when the profile says shared; a shared workspace is unaffected; an invalid file changes
nothing and reports why; an imported script appears in `project_checks_actions`.

Verification: schema tests (valid, missing key, invalid enum, unknown key), resolver-order
tests in `jj-integration`, one E2E journey that adds a fixture repo with the file and starts a
thread.

### P5 — Prepare the checkout before the first turn

Goal: "run the setup" stops being a manual thing you remember.

- [ ] Let a `project-checks` action carry `runOnWorkspaceCreate` and `onSettle` flags (trusted
      configuration only, same file), and have `jj-integration`'s thread warmup invoke the
      Host's durable dispatch for the flagged action after the workspace exists.
- [ ] Publish the run as warmup phases (the warmup already has explicit phases) so the
      composer shows "Setting up · pnpm install" while the first turn is prepared, with a
      cancel control, and an opt-in "wait for setup before the first turn" flag.
- [ ] Keep the existing safety: durable tasks stay idempotent, cancellation reports
      `cancelled` only after the process group exits, effects before cancellation are not
      undone.

Acceptance: with a flagged action, starting the first thread in a new workspace runs it once,
shows its phase, and cancelling it leaves a receipt; without a flag nothing runs.

Verification: unit tests around the warmup → dispatch seam; one E2E journey with a harmless
flagged command (`node -e` writing a file) asserting it ran in the workspace, not the project.

### P6 — Project identity and the small gaps

Goal: projects look like projects and say where they are.

- [ ] Host-side project icon resolution, cached: `iconPath` from `dsh.project.json`, then a
      short candidate list (`assets/icon.svg`, `public/favicon.svg`, `favicon.svg`, …), then a
      stable monogram from the title. One HTTP-cached read per project; no client-side scanning.
      Render it in the sidebar project row, the picker and the New-thread destination bar.
- [ ] Group checkouts of one repository as one project (reuse the `multi-host` origin grouping
      and `RepositoryIdentityResolver`-style cache) with a per-machine badge, instead of
      treating each path as an unrelated project.
- [ ] `No folder` promotion: **Turn into project** on a No-folder thread registers its cwd
      (with P1's inspect in front) and moves the thread's project grouping.
- [ ] Cleanup parity leftovers: a `merged` kind (only when the PR merged and every revision is
      on the target line), protection tiers stated in the settings copy, and a reasons report
      on the cleanup result (`kept because: unlanded revisions | live session | queued
      integration | recent use`).

Acceptance: a repo with `assets/icon.svg` shows it without configuration; a monogram appears
otherwise; two checkouts of one origin group together; cleanup reports one reason per kept
workspace.

Verification: icon resolver tests over a temp tree, grouping tests over two clones, snapshot
of the cleanup reasons.

## Not copying

- **Multi-forge provider matrix** (GitLab, Forgejo, Bitbucket, Azure DevOps, GitCafe). Our
  single-host `gh` coverage plus `project_publish` closes the onboarding loop; a forge port
  belongs to the `pull-requests` plan, not here.
- **Project-controlled auto-run commands.** `t3.json` executes on worktree creation; our
  `project-checks` refuses repository-controlled configuration for good reasons. P4/P5 keep
  the import step.
- **Worktree submodules and Git dirty-file tiers.** No jj analogue; `git-worktrees` already
  handles the Git-only case it can actually reason about.
- **Creation without Git identity.** t3code creates the project and reports `commitError`; we
  require jj, so the New project path keeps refusing before writing and names the fix.

## Decisions needed

1. **P2 scope: project-first clone, or toast-only?** t3code creates the project before the
   clone and refuses sends centrally. Our send path is native (composer + session-controller),
   so gating it means forking those native packages. Recommendation: keep registration at the
   end of the clone, add retry + a clone surface outside the dialog, and revisit project-first
   only if the missing draft proves painful. Cost of the full version: one native fork.
2. **Where `dsh.project.json` lives.** Recommendation: schema + loader in
   `@dshfiles/workspace-folder-picker` as a published dshx module (it already owns the project
   lifecycle), consumed by `jj-integration` through that module and by `project-checks` for the
   import. Alternative: a small owner plugin; more code, cleaner dependency direction.
   Constraint either way: no dependency cycle (`pnpm check:cycles`).
3. **P4 tier breadth.** Recommendation: file-backed non-executable keys only in v1. A general
   project-override store is a much larger feature and belongs in its own plan.
4. **P6 icons.** Recommendation: auto-detect + config override, no icon picker UI in v1.

## Verification

Run per phase, not at the end: `pnpm --dir plugins/@dshfiles/workspace-folder-picker test`,
`pnpm --dir plugins/@dshfiles/jj-integration test`, `pnpm typecheck`, `pnpm lint`, then one
`dshx dev` journey per phase in a scratch DSH (`dshx dev up`, `open`, `shot`, `down`). Each
phase lands as one described revision; the files above are the expected touch set, not a
promise about shape.

## Receipts

Filled as tasks land; empty means unverified.

| Phase | Task | Evidence |
| --- | --- | --- |
| P1 | project inspect method | `src/folder-inspection.test.ts` 6 tests green; `project_inspect` + `project_init` bound in `src/host.ts` |
| P1 | Enable Jujutsu action | `repository-setup-contract` provided by `@dshfiles/jujutsu`; `project-folder-setup.tsx` renders it; gherkin `workspace-folder-picker.folder-setup` added (run pending) |
| P1 | jj-integration non-repo state | — (open) |
| P2 | clone stages + retry | 15 tests in `project-lifecycle.test.ts`; retry refuses running/succeeded jobs |
| P2 | clone surface outside the dialog | — (open: needs a global slot owner) |
| P3 | project_publish | 2 tests: jj bookmark push to a bare remote, and the three refusals |
| P3 | publish UI entry | — (open) |
| P4 | dsh.project.json | — |
| P5 | setup on workspace create | — |
| P6 | icons, grouping, promotion, cleanup reasons | — |
