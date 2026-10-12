# JJ history consolidation

Dated closeout records for whole-graph history surgery in this repository's shared JJ store. Each
section states what was unified, the revisions involved, how tree preservation was checked, and how
to roll the rewrite back. Durable jj guidance stays in
[`AGENTS.md`](../AGENTS.md) and the `jj-shared-workspace` skill; this file records executed surgery.

## 2026-10-12 — fold the fork above `abcf899c` back into one line

### Shape before

Four heads and six divergent change-ids above the fork base `abcf899c`
(`feat(agent-communication): distinguish requests from notices and make delivery idempotent`):

- the folder-picker spine `22ba671a` … `5651983f`, where `main` and `integration-spine` pointed;
- `e86db8c6` (`fix(thread-sidebar): restyle archive undo notice`), the `thread-archive-toast-final` `@`;
- the post-reconciliation chain `b9e72eac` → `e22b88f3` → `43c1da61` → `adef8da7` carrying optmem,
  jj-integration, activity-timeline and jj-integration audit hardening, with empty slots on top;
- older partial copies of that chain (`93bb7ff6` → `55f9af43` → `69609617` → `80bb07c0` → `8230892d`),
  a second change-id for the activity-timeline work (`wrqpkzys` `2ba90909`/`5ab6c0ba`), and empty
  `wip` heads (`f1cb41f3`, `e4cf736e`).

Divergent change-ids: `rqrwtkou`, `tkzrxunr`, `smkovuom`, `wswotqqx`, `wrqpkzys`, `pmsmusyk`.

### Shape after

One line, one head, `main` and `integration-spine` on it, and every live workspace `@` an empty
described slot on the line:

`abcf899c` → folder-picker spine → `e146077b` → `171ef985` → `0e3e3836` → `9df941e0` → `b5bafb3d` →
`70d25f1c` → `34269bdd` → `6f494ac3` → `chore(jj): workspace slot for default`.

Content revisions and the slots are stable; a slot's commit id changes whenever its workspace edits
it, so the tip is named by description rather than by commit id.

| Pre-surgery revision | Now | Content |
| --- | --- | --- |
| `5651983f` and the spine below it | unchanged | folder-picker chain, `docs(workspace-picker)` tip |
| `e86db8c6` | `e146077b` | `fix(thread-sidebar): restyle archive undo notice` |
| `b9e72eac` | `171ef985` | `feat(optmem): add the Workbench Explorer and backlog recovery` |
| `e22b88f3` | `0e3e3836` | `feat(jj-integration): add the jj workspace lifecycle and integration coordinator` |
| `43c1da61` | `9df941e0` | `feat(activity-timeline): add the unified agent activity feed` |
| `adef8da7` | `b5bafb3d` | `fix(jj-integration): audit hardening for empty revisions and validation receipts` |

Slots, in line order: `70d25f1c` (agent-comm-audit), `34269bdd` (thread-archive-toast-final),
`6f494ac3` (workspace-folder-picker-browser-latest), then the default slot at the tip.

### Twin resolution

- Kept the 01:47 reconciliation copy of every divergent change-id. The older copies are strict tree
  subsets: `93bb7ff6` predates the optmem runtime, SQLite and e2e work, and `55f9af43`/`69609617`
  repeat `e22b88f3`/`43c1da61`.
- The audit-hardening change lived under two change-ids: `wswotqqx` `adef8da7` and `pmsmusyk`
  `8230892d`, with `adef8da7` keeping one extra assertion
  (`run.candidate.validation.kind === 'command'`). Kept `wswotqqx` and reused `pmsmusyk`'s message,
  which described the same content.
- activity-timeline existed as `smkovuom` `43c1da61` and `wrqpkzys` `5ab6c0ba` with identical trees;
  kept `smkovuom`, because its lineage also carries the hardening revision.
- Abandoned: `93bb7ff6`, `55f9af43`, `69609617`, `80bb07c0`, `8230892d`, `2ba90909`, `5ab6c0ba`,
  `f1cb41f3`, `9cf57cff`, `76418dba`, `e4cf736e`. The two parked empty slots (`cce45169`,
  `e9ed7dae`) were replaced by fresh described slots in their own workspaces.
- A first attempt described revisions after a rebase had already moved their descendants, which
  produced a second twin lineage (`c0d1a0e1`, `04ff9d38`, `2c7c3005`, `62842564`, `a9f87085`,
  `41be804c`, `59f8d0a3`, `f071c8c2`, `1fc61aa6`, `3f1b3b97`, `6b34b368`, `ae79c7e2`, `511b522f`).
  It was abandoned in the same session. Describe by re-resolving the change-id after every rewrite.

### Preservation proof

`jj diff --from <origin> --to <tip> --summary` reported **no deleted path** for every pre-surgery
content origin — `5651983f`, `e86db8c6`, `b9e72eac`, `e22b88f3`, `43c1da61`, `adef8da7` — so no three-way
merge silently dropped a block. On the tip, `plans/README.md` carries both the
`jj-integration-coordinator` row and the optmem row, and `plugins/pnpm-lock.yaml` lists the
`@dshfiles/activity-timeline`, `@dshfiles/jj-integration` and `@dshfiles/workspace-folder-picker`
importers and matches the activity-timeline revision's merged lock line for line (18809 lines).
`pnpm --dir plugins install --frozen-lockfile` passes on that lock.

### Validation on the merged tree

Passing package suites: `@dshfiles/activity-timeline` 14/14, `@dshfiles/jj-integration` 15/15 (one
flaky first run before the green rerun), `@dshfiles/optmem` 49/49, `@dshfiles/optmem-core` 29/29,
`@dshfiles/optmem-sqlite` 36/36, `@dshfiles/thread-sidebar` 102/102.

`pnpm run check:plugins:cached` (contract/build/typecheck/test) does **not** complete on this machine,
for reasons that predate the surgery and are identical on both sides of the fork:

- `tooling/dshx/packages/dshx/dist` was built before `abcf899c` changed the
  `@dshfiles/dshx/communication` contract, so `agent-communication` still typechecks against a
  `CommunicationMessage` without `intent`/`correlationId`/`dedupeKey`;
- rebuilding `@dshfiles/dshx` fails on vendored `tooling/dsh-core/api-session-controller/lib`, which is
  older than its own `src/` (it exports `./client/contracts` → `lib/types/client/contracts.d.ts`, but
  the generated tree only has `lib/types/contract/`);
- `DSH_SOURCE_ROOT=/Users/astahmer/dev/dsh-core-rich-queue-edit pnpm run sync:core-api-session-controller`
  fails with `TS6305` because that checkout's dependency packages (`vendor/cordis`,
  `packages/core/session`, `packages/llm/llm`, `packages/typert/protocol`) have no built `lib/`. Building
  them is the heavy source build the repository rules ask us to report rather than start silently.

`pnpm run check:diff --from 5651983f --to @` reports 120 antislop warnings and 0 errors in the folded
optmem/jj-integration sources: the repository's known lint/format baseline drift on that work, not a
merge finding.

### Remaining gates

- Refresh the vendored core, rebuild `@dshfiles/dshx`, then run
  `pnpm run check:plugins:cached --force` on this line. The `history-repair`
  workspace regenerated the vendored `lib/`, but its client-session source
  divergence was **not** advanced here — see [the repair record
  below](#2026-10-12--repair-the-vendored-core-artifacts-and-the-typecheck-contracts).
- `@dshfiles/activity-timeline` and `@dshfiles/jj-integration` are on the line but are **not** in
  `profiles/web/package.json`, so nothing about the live profile changed.
- `main` and `integration-spine` are local only; no `jj git push` was run.

### Recovery

The operation bookmark taken before the first rewrite is
`77dac5cf0de0098f9b86d1b5e9c25bde267baa5543c850c710860482cb8bcf0b4e3bda44fd2a8eedc7483f4cf7cdb38ae3a93cb48833336de9dca8e229bc2a68`.
`jj op restore <that id>` returns the store to the pre-surgery graph. It also discards every operation
that any agent recorded after it, so take a fresh bookmark first.

## 2026-10-12 — repair the vendored core artifacts and the typecheck contracts

Isolated workspace `history-repair` (`/Users/astahmer/dev/dshfiles-history-repair`), based on the folded
line; `main` and `integration-spine` were not advanced.

### Stale artifacts (repaired)

`tooling/dsh-core/api-session-controller/lib` was older than its own `src/` and manifest: the local
`src/client/contracts.ts` and the local `./client/contracts` / `./client/module` exports had no emitted
declarations, so `@dshfiles/dshx` could not build (`TS2307: Cannot find module
'@deepseek-ai/dsh-api-session-controller/client/contracts'`) and every plugin that typechecks through the
dshx dist failed — the first failure surfaced at `agent-communication` as a misleading
`CommunicationMessage` "no `intent`" error.

The package was regenerated with the documented generator against a clean, built, pinned checkout:

```sh
DSH_SOURCE_ROOT=/Users/astahmer/dev/dsh-core-activity-rc2 pnpm run sync:core-api-session-controller
```

170 outputs, SHA-256 `1024708ddf4d42e4dec7871d08425c7ad98d48b39fb6836ef5e38876170b7a85`, reproduced twice. It
added exactly the four missing `lib/types/client/contracts.{d.ts,d.ts.map,js,js.map}` files, removed none, and
is **newer** than what it replaced (`SessionRuntimeSelection` and `fork({ runtimeBinding })` are additions, not
downgrades). `create-dshx` and `@dshfiles/dshx` then build clean; no tracked file changed (`lib/` and `dist/`
are gitignored).

### Client Session service separated from the host Context (proposed, not on this line)

The vendored client entry merged the Client Session service into the shared Cordis `Context`
(`declare module '@deepseek-ai/cordis' { interface Context { sessions: ISessions } }`). Upstream compiles a
Client package in its own TypeScript project, so that merge never meets the Host `SessionStore` declaration;
this repository typechecks one package's Host and Client faces in a single program, where the merge shadowed
the Host store. No newer core branch carries a different arrangement —
`dsh-core-settings-native-verify-20261011` declares the same merge — so the separation is local to this fork.

`27f7238e` removes the merge from `tooling/dsh-core/api-session-controller/src/client/index.ts`, records the
divergence in `tooling/dsh-core/FORK.md`, and types the Queue Reorder client editor's context as the
client-only `ClientContext` from `@dshfiles/dshx/client`, whose `ClientServiceMap.sessions` carries
`ISessions` — no casts and no duplicated host typing. The generator still emits the Client declarations and
bundles, `queue-reorder` typechecks, `editor` loses its `ISessions.get` diagnostic (6 → 5), and every other
package typechecks in that workspace.

**Not advanced onto the consolidated line.** When the separation was transplanted onto the current spine it
regressed `queue-reorder` (`submission`/`existing` untyped) and `optmem` (`client-entry.tsx` lost the
`ISessions` shape), because `ClientContext.sessions` is looser than the merged `Context.sessions`. The
regeneration of the vendored `lib/` is kept in the `history-repair` workspace instead.

### Editor stays explicitly blocked (decision)

`editor` needs `SettingsTargetRoute` and the `settings.general.item` owner prop `target` from a newer
`@deepseek-ai/dsh-client-ui-settings`. That API is absent from the installed `0.2.0-rc.2` **and** from the
newest published pre-release `0.2.1-alpha.2` (checked in the published tarball); it exists only in unreleased
local core work (`dsh-core-settings-native-verify-20261011`, `dsh-core-settings-search-native`,
`dsh-core-settings-native-integration`), and the pinned generation has no `settingsTargets` service anywhere.
Vendoring that one package would therefore ship target-routing client JavaScript with no runtime counterpart,
so `editor` stays blocked rather than shimmed or downgraded. Its client half already degrades when the service
is absent.

### Activity Timeline high-volume test (fixed)

`ingest` durably rewrites the whole state document per event (read, schema parse, temp write, rename), so 1200
events cost about 1200 write cycles. The test hit vitest's 5 s default whenever the machine was busy, which is
why the same file passed alone and failed inside the parallel workspace run. `b9621310` gives the test an
explicit 30 s budget (this repository's jujutsu integration tests use 20 s) and adds a deterministic bound
that the persisted document does not grow with the ingested total (`< 1.5×` the 600-event size), which still
fails a window that stops trimming. Measured for that test: about 0.3 s in a quiet parallel sweep, 1.9 s idle
standalone, 4.8 s standalone while builds ran, and 5.005 s — exactly the old default timeout — under the
original loaded run.

### Validation

In the isolated workspace, on the tree carrying `27f7238e` and `b9621310`:

- `pnpm run check:plugins:cached --force` (`7b6668201883afbb`): `contract` PASS; `build` FAIL — the runner
  stops at `editor`, the only failing package.
- `--no-bail` sweeps: build fails only in `editor`; typecheck fails only in `editor`; the whole test sweep
  passes (32 packages).
- Plugin `dist/` rebuilds stayed inside the isolated workspace; no profile was synced and no live Host was
  restarted.

### Remaining gates

- `editor` build and typecheck stay blocked on the settings-target contract above.
- The fix revisions are on this line only: `main` and `integration-spine` still point below them, and the
  shared checkout's vendored `lib` and `dist` need the same regeneration once the line is advanced.
