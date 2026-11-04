# Phase 4a evidence: review → land on one surface

Scratch DSH (full `profiles/web` composition, prebuilt bundles from the `ade-4a-changes` workspace),
seed `rebase-ready-thread`. Desktop shots are WebKit 1440×900 unless named `chromium`; the phone
shot is WebKit 390×844 with an iPhone user agent (the Phase 0 driver,
[`baseline/capture/phone.mjs`](../baseline/capture/phone.mjs)).

## The journey

| # | Step | Result | Shot |
| --- | --- | --- | --- |
| 0 | Open the thread, click **Review workspace changes** in the composer bar | The right pane opens the **Changes** facet: Land card on top, scope switch, 1 file, its diff | [00](00-changes-facet-desktop-chromium.png) |
| 1 | Mark `seeded-work.md` viewed | `1/1 viewed`; still viewed after a fresh browser context (the mark is in diff-viewed's Host store) | [00](00-changes-facet-desktop-chromium.png), [02](02-land-preview-desktop.png) |
| 2 | Inbox › Other before landing | "sample · thread-… is ready to land" with Land / Open / Done / Snooze | [01](01-inbox-ready-to-land-desktop.png) |
| 3 | **Land** on the card | Confirm dialog previews the exact revision (`zyoqnzkq Seeded work to rebase`) before anything moves | [02](02-land-preview-desktop.png) |
| 4 | **Land on main** | "Landed 1 revision on main."; the card reads "Nothing to land"; the transcript shows the landed row | [03](03-landed-desktop.png) |
| 5 | Inbox › Done | The ready-to-land item is **Resolved** | [04](04-inbox-resolved-desktop.png) |
| 6 | New uncommitted files, Uncommitted scope, click line 1 of `answer.ts`, comment, **Add to next message** | Composer shows the chip `@answer.ts:1`; the Land card blocks the undescribed revision with its reason | [06](06-comment-chip-desktop.png) |
| 7 | Phone 390×844 | The thread renders without horizontal overflow; the right pane (so the facet) has no phone presentation yet | [07](07-changes-facet-phone.png) |

In step 5 the item resolved only on the provider's 2-minute safety tick: that scratch Host ran the
jj-integration Host half from before `jj:mvlrprss`, which now pokes the inbox reconcile after every
`land`. A second scratch on the new Host bundles walked the `pulls-review/land-card` reach (seed,
Review workspace changes, Land, Land on main) and the Inbox showed the item **Resolved** with
nothing left in Other about 20 seconds later, including the driver's page load
([05](05-inbox-resolved-immediately-desktop.png)). `attention-provider.integration.test.ts` ›
"resolves the Ready to land item as soon as the Changes facet lands through the land method"
proves the same on a test Host with real jj. The Host change reaches a live DSH only after the user
restarts it.

Counts: review → land now crosses **1 surface** (the thread's Changes facet; the Inbox only
mirrors it) with **1 verb** (Land), against 4–5 surfaces and 5 verbs in
[current-ux §2 #4](../research/current-ux.md#2-primary-journeys-today).

## Decisions

- **Owner: pulls-review.** It already owns scoped review (Host `jj diff`, pulls.review scopes), the
  dshx `Changes` contract and reviewed marks, and already depends on jj-integration's API module,
  so the Land card adds no new dependency direction. sidebar-right is a native fork that hosts tabs;
  product features stay out of it.
- **One viewed-marks store: diff-viewed.** Its per-turn keys stay `[sessionId, seq, path]`, so the
  native review tab's marks need no migration. Revision scopes add
  `["range", workspacePath, base, head, path]` (head is the commit id, so a new revision starts
  unread). The Review page's old `reviewed` record moves in once, in batches, and is emptied only
  after the write succeeded. Range marks have their own 5,000 bound and stay out of `state`, so the
  native tab's poll does not grow.
- **The turn card opens Changes** by claiming the native `dsh-resource://changes-review/**`
  address at the `extension` band and redirecting to the one facet scoped to that turn; no native
  fork.
- **Line comments** use the public dshx `Composer.attach({ kind: 'comment' })`; rich-composer
  already renders and serializes them.
- **Land stays guarded and previewed.** The card's Land opens a confirm dialog listing the
  revisions and then calls jj-integration's `land`, so every Host guard (busy threads, undescribed
  revisions, conflicts) applies. A busy thread gets **Land when idle** (the existing queued land,
  with Undo).

## Gaps (recorded, not faked)

- **git-worktrees:** the VCS provider port has no diff verb, so revision scopes need a Jujutsu
  workspace; a git-worktree workspace gets This turn (DSH's own snapshot) and a message saying why.
  A `diff` method on `@dshfiles/vcs-provider-port` with a git-worktrees implementation would close it.
- **Rebase only:** jj-integration has no rebase-without-advancing verb. The card's History link
  opens the revision graph, whose previewed rebase mutation covers it.
- **Phone:** the facet is reachable only where the right pane shows; facets as sheets is Phase 6.
- **Turn-card journey in e2e:** it fails at the fake-model write turn ("Cannot read properties of
  undefined (reading 'prepare')"), the core tool-scheduler error the earlier phases already hit;
  see the comparison below.

## E2E comparison (branch vs main)

Filled in from `pnpm check:e2e <plugin>` runs in `ade-4a-changes` and a temporary main workspace.

Final run on main `jj:qotvsokuzqux` (both workspaces rebuilt, `pnpm check:e2e pulls-review diff-viewed jj-integration`):

| Plugin | main | branch | Notes |
| --- | --- | --- | --- |
| pulls-review | 3/3 | 3/5 (4/5 in an earlier run) | New: Changes facet + Land + line comment journey passes. Turn-card journey fails at the fake-model "Edited" card, the same step all three diff-viewed journeys fail on main. batch-reviewed failed this run in setup ("Session hierarchy" after sending), passed in the previous branch run |
| diff-viewed | 0/3 | 0/3 | Identical failure on both: the fake model's write turn never shows an "Edited" card |
| jj-integration | 16/23 | 15/23 (16/23 in an earlier run, same 7 failures as main) | The extra failure this run ("Switching the thread destination preserves structured composer references", composer textbox not visible) is in a destination flow this branch does not touch, passed on the earlier branch run, and the run took 14.5 min vs 8.5 min on main under machine load |

Branch failures ⊆ main failures plus load-flaky setup steps; no regression attributed to this branch.
