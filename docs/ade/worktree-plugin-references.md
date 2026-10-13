# Reference audit — DSH worktree plugins

Five Git-worktree plugins were inspected as architectural references, not adopted.
We keep jj and our decided model (eager one-workspace-per-thread, one exclusive
writer, manual integration, automatic safe retirement).

## `wloops/dsh-git-worktree` — the one that matters

Inspected: repository tree at `cf57c378`, plus
`src/client/workspace-sidebar/UPSTREAM.md` (raw, HEAD).

Its integration strategy answers our open blocker **without patching DSH core**,
which is exactly the priority we were given.

### What it does

- It **does not patch `dsh-workspace` or the session controller.** Instead its
  `cordis.patch.yml` **conditionally disables the official
  `@deepseek-ai/dsh-client-ui-workspace` loader row** and mounts its own client
  that **proxies** the official one.
- The proxy "preserves its official declaration tree, WorkspacePicker, locale
  dictionaries, stores, and directory-flow behavior. It replaces the **Browser
  data projection**."
- It gates on the exact package version **and compiled client SHA-256**, and
  selects one derivative via strict Remote topology; an unknown generation keeps
  the official provider rather than mounting a guessed replacement.
- It reconciles the row through **public Loader entry update/refresh** operations
  — including late Include activation and disable-list replay — **without
  persisting a disabled flag**, and restores the official row on deactivation.

### The constraint it documents, which we would hit too

> "The public Slot ledger can elect a lower-priority Browser, but a wrapper entry
> cannot inherit the original entry's child-slot authorization: omitting
> `children` removes the `renderSlot` seat, while repeating `children`
> redeclares `sidebar.workspaces.directoryFlow`. Therefore `cordis.patch.yml`
> conditionally disables the original loader row…"

So a wrapper is not possible: the official row must be disabled while the
replacement is active, and restored afterwards.

### The concept we were missing

It implements **managed workspaces** with **owner identity** and **guards at the
client-projection and service level** — "Managed owner identity, status, unsafe
row operations", "Service-level guards block owner forks and new Sessions in
managed Workspaces" — rather than relaxing the workspace entity.

That is the maintainable route to our two concepts:

- **logical project** — grouping/navigation, decided in the **client projection**
  (`sidebar.workspaces.directoryFlow` and the official tree);
- **physical execution workspace** — the real jj directory, owned by the official
  `dsh-workspace` entity, whose `cwd === record.path` validation we leave intact.

Our current blocker is that `WorkspaceEntity` keys visible sessions by exact path
equality (`dsh-workspace lib/index.js:103`). A client-side projection is not
bound by that filter and can group by our persisted ADE metadata, which is what
the handoff asked for: "Use our existing sidebar/thread plugins and persisted ADE
metadata for grouping wherever practical."

### What is reusable, concretely

1. **Row-disable-and-proxy pattern** for the workspace browser — keeps core
   untouched and is reversible on deactivation.
2. **Version + SHA-256 gating** with a fail-open-to-official default for unknown
   generations. Our deployed generation is `0.2.0-rc.2`, one of their three
   pinned variants, so the rc.2 derivative is the closest match.
3. **Public Loader entry update/refresh** reconciliation with no persisted
   disabled flag — avoids a boot-order trap.
4. **Managed-owner guards at service level**, not in the entity.

### What is not reusable

- Everything Git-specific: `src/adapters/git.ts`, `worktree-creation.ts`,
  `initial-commit.ts`, `managed-worktree-path.ts`, preview/commit confirmation
  flows. We provision with `jj workspace add` and integrate through our spine.
- Their delivery/preview console (≈54 KB `ReviewActions.tsx`, large i18n
  catalogs) — far beyond this release's scope.
- It is a large codebase (a 200 KB session-checkout module alone). We should
  borrow the **pattern**, not the code.

## The other four

Not yet inspected in detail; their stated scope overlaps what we already have:
`CSY656/dsh-worktree` (acquire/release + clean-vs-dirty safeguards — we have this
in `cleanup.ts`), `Luck9Star/dsh-worktrees` (serialized integration + conflict
preservation — we have this in the integration coordinator),
`lisycotana/dsh-workflow-worktree` (ownership binding + restart recovery — we
have durable writer leases), `HeathHe/dsh-worktree-panel` (project → worktree →
session sidebar grouping — the same projection idea as `wloops`).

## Effect on our plan

The release candidate is unchanged: the workspace-attach fix in a cloned runtime
is proven. What changes is the **association** implementation. Instead of
registering the provisioned directory as a top-level workspace (which would
clutter the sidebar, against the decided UX), the better route is a
**client-projection layer** that groups threads under their logical project using
persisted ADE metadata, with the official entity validation untouched.

That is a larger change than the release should carry, so it belongs to the
post-release lifecycle phase unless the browser acceptance shows grouping is
required for the release gate. If it is required, the smallest version is: keep
the official row, add a **sidebar projection plugin** that reads our registry and
groups, and only escalate to the disable-and-proxy pattern if the slot ledger
refuses the lower-priority Browser.
