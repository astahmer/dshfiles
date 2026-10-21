# Settled threads

## Why

The native archived state is a Host admission gate, not a sidebar flag: an archived Session (or a
subagent descendant) runs no model step, native navigation drops it from the main view right after
it opens (`clearArchivedCurrent()`), and the client then reports `Session reference … is released`.
Auto-archive pushed idle threads into that state, so clicking an idle thread fought the native
cleanup and spammed the console.

Decision (2026-10-18): keep native archive as the manual **hard** verb (stop work, block wakes,
requires Restore), and add our own soft status **Settled** for idle threads: still listed, still
openable, but no model step starts until it is unsettled. Auto-archive now settles. Threads already
natively archived stay archived — no migration sweep.

## Design

| Piece                                                                               | Where                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `settledSessionIds` in the Host settings namespace (`thread-sidebar`)               | `src/preferences.ts`, `src/settings.ts`                                                    |
| `settled` sidebar section, row/context actions, auto-settle scan                    | `src/organization.ts`, `src/client.tsx`, `src/sidebar-shell.tsx`, `src/rebased-threads.ts` |
| Host no-wake gate over `agent/pre-step` (Session + subagent lineage)                | `src/settled-gate.ts`, `src/host.ts`                                                       |
| Agent parity: `thread_settle`, `thread_unsettle`, `settled` on `thread_list`        | `src/thread-actions*.ts`                                                                   |
| Composer banner "Unsettle to reply"                                                 | `src/settled-thread-dock.tsx`                                                              |
| Archived row click = Restore and open (one click, retry machine deleted)            | `src/client.tsx`                                                                           |
| Settings keys decode from the legacy `autoArchive*` names                           | `src/preferences.ts`                                                                       |
| `mainTabs.closeActive` no longer claims desktop Mod+W (native `page.close` owns it) | `plugins/@dshfiles/main-tabs/src/client.tsx`                                               |

Renamed settings keys: `autoSettleEnabled`, `autoSettleSessionIds`, `autoSettleDisabledSessionIds`,
`rebasedThreadSettleDelay`.

## Progress

| #   | Step                                                                    | State |
| --- | ----------------------------------------------------------------------- | ----- |
| 1   | Model: sections, preferences, settings schema, legacy decode            | done  |
| 2   | Client: section, settle row action, context menu, auto-settle scan      | done  |
| 3   | Composer banner + archived Restore-and-open, retry machine deleted      | done  |
| 4   | Host: pre-step gate, settings host scope, settle verbs, agent tools     | done  |
| 5   | Locales, README, host gaps, agent-tool parity, feature catalog          | done  |
| 6   | Unit tests (241 pass) + e2e journey and feature scenario                | done  |
| 7   | Verify: build, typecheck, tests (242), plugin boot (45/45), e2e journey | done  |
| 8   | `main-tabs.closeActive` shortcut conflict                               | done  |

## Root cause found while verifying

The settle e2e journey failed with no composer banner, and the cause was not the new status: decoding
the Host settings document had always failed. Schemastery drops a **null-valued union field** from its
resolved output, and `workspaceFilter` was the one decoder field without its own default, so
`preferencesInputSchema` (strict) rejected every Host document, `hostBacked` stayed false, and the
whole namespace silently fell back to browser local storage. The Host document on this machine is all
defaults, which is what that looks like from the outside; the new `settledSessionIds` never reached the
Host, so the settled thread's composer banner could not appear.

Fixed by giving the decoder the same default the Host schema declares, plus a regression test that
resolves the settings schema and decodes its output, so a future nullable field without a decoder
default fails in the unit suite instead of in the browser. With the namespace live, existing browser
copies migrate to the Host through the plugin's existing one-time migration.

The composer banner had a second, independent flaw: the dock read the Settings namespace directly
while the sidebar follows `usePreferences` (Settings when the Client has them, the browser copy
otherwise), so in the isolated journey profile — where the sidebar runs without Host-backed
preferences — the settled id never reached the dock and no banner appeared. The dock now renders from
`usePreferences` too, which is one status source in every profile.

## Known limits

- The gate walks the subagent lineage through live agents' headers plus the child's recorded
  `parentSession`, so a settled *grand*parent whose intermediate subagent is no longer live is not
  detected. The client refuses to settle a thread with a running descendant, which covers the case
  that matters.
- `feature-coverage --check` still reports one pre-existing thread-sidebar issue
  (`usage-limit-group` has no Gherkin journey) and stale references in other packages
  (`pulls-review`); neither is touched by this change.

## Incidents

- The working copy was clobbered mid-session by a concurrent `jj` operation from another workspace
  (`thread-5c0266`), which reset this workspace's `@` to empty while `default@` reconciled divergent
  operations. The change set was recovered from the checkpoint commit `d99d9f3bc43d` (a divergent copy
  of this workspace's change id) as a patch, re-applied onto the then-current `main`, and split into
  two described revisions. Run jj commands in this workspace only when no other session is mid-flight,
  and prefer `node --run check:diff` over a repo-wide format pass: the whole-repo `oxfmt` snapshot made
  the concurrent rewrite far more likely.
- The live settings document still holds the legacy keys (`autoArchiveEnabled: false`,
  `rebasedThreadArchiveDelay: 'disabled'`), which the strict preference schema rejects unless they are
  upgraded: without `upgradeLegacyPreferenceKeys` the sidebar would have silently decoded no Host
  preferences at all. Both legacy values are at their defaults, so the new keys start at their
  defaults too, and the generated form cannot disagree with the decoded value.

## Verification evidence

- `pnpm --dir plugins/@dshfiles/thread-sidebar test` — 242 passed before the rebase, 261 after
  (main added its own tests); `main-tabs` 44 passed.
- `tsc` clean for both packages; `node -e "import('./dist/index.js')"` on the built Host bundle.
- `node --run check:plugin-boot` — 45/45 bundles, client boot passed.
- `node --run check:diff` — 0 errors on the 38 changed files.
- `feature-coverage --check` — no new issue; one pre-existing thread-sidebar gap (`usage-limit-group`
  has no Gherkin journey) and stale `pulls-review` references remain untouched.
- `check-browser.mjs e2e thread-sidebar`: `thread-sidebar.settle` passes in every run after the dock
  fix. Five runs each reported **26 passed, 1 failed**, and the single failure was a _different_
  scenario every time — `custom-views`, `mention-insertion`, `notification routes`,
  `archived-open-notice` (the shared `startBlankThread` helper timed out waiting for the URL) and
  `open-in-side-panel` (a dock-tab count). Every failure is a timing-sensitive `toHaveCount` /
  `toBeVisible` / URL-poll assertion outside this change, on a machine at load average 10-18 with other
  sessions' browser suites running; no failure repeated across runs.

## Rebase

Two rebases were needed because other sessions kept landing thread-sidebar work.

**First** (onto `9c7bf8c8`): two conflicts, resolved by keeping the landed work and dropping the
deleted archived-view imports — `plugins/@dshfiles/thread-sidebar/README.md` (main's new
"Settings › Thread sidebar" paragraph kept, auto-settle wording applied) and
`plugins/@dshfiles/thread-sidebar/src/client.tsx` (main's new imports and notification-tone maps kept,
`rebasedSettleDelayFromValue` kept from this change).

**Second** (onto `41125a620313`, after the notifications, session-search and row-half-click work):
one conflict, in `tooling/dshx/e2e/support/plugin-journeys/thread-sidebar.steps.ts`, resolved by
keeping both intents — main's `openThreadRow` / `openThreadRowMenu` helpers now open the rows in this
change's archived-open and settle journeys, while this change's replacements stay in place: the
archived-open `When` drops the removed "Restore and open" notice assertions, and its `Then` keeps the
restore-and-open assertions followed by the settle journey. Main's row-click helpers are used
everywhere this change touches a row.

After the second rebase: typecheck clean, 263 unit tests pass, `check:diff` 0 errors, and
`check-browser.mjs e2e thread-sidebar` reports **27 passed, 0 failed** — including
`thread-sidebar.archived-open-notice` and `thread-sidebar.settle`.

Resume here: nothing — both revisions are described and rebased; land or review them.
