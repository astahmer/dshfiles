# UI backlog handoff — dshfiles

Snapshot: 2026-11-08. Source: local Backlog (226 open items: 217 `todo`, 9 `inbox`; 1 unrelated item is `doing`).
Backlog statuses were **not** changed for this handoff. Item numbers below are `b:<n>` refs; titles are shortened.

Repo: `astahmer/dshfiles` (Jujutsu colocated). Owned plugins live in `plugins/@dshfiles/<name>`; native DSH packages we
replace are listed in `docs/native-forks.md`.

## Before you start (read once)

1. `AGENTS.md` at the repo root is the contract: `jj` only, one described revision per logical change, never push.
2. Never restart the live DSH instance, and never rebuild into somebody else's workspace. Do graphical work in a scratch
   instance (`dshx dev up|doctor|open|shot|down`, skill `verify-dsh`) or in your own `jj_thread_isolate` workspace.
3. Any plugin UI change: skill `plugin-ui` first, screenshot refresh required (`node --run check:screenshots`), and the
   client/Host halves ship together (`cordis.patch.yml` row + `dist/client.js`).
4. Useful checks: `pnpm --dir plugins/@dshfiles/<plugin> test`, `pnpm typecheck`, `pnpm check:cycles`.
5. Upstream-facing work goes through the `dsh-upstream-pr` skill, not a fork-only commit.

## A. Ready-to-pick upstream GitHub issues (7)

These already carry a crisp problem statement and acceptance criteria on `astahmer/dshfiles`. Comment on the issue
before starting so two people don't collide — three of them already have activity from outside contributors.

| #   | Issue                                                 | Item                                                                 | Owner plugin                     | Note                                                                                                                                                     |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | [#34](https://github.com/astahmer/dshfiles/issues/34) | b:32 quote a conversation message into the composer                  | `rich-composer`                  | Small. Insert editable quote + source context, keep it in the draft until send.                                                                          |
| A2  | [#35](https://github.com/astahmer/dshfiles/issues/35) | b:86 persistent notification history                                 | `activity-timeline`              | Medium. Bounded history, read/dismiss/clear, navigate back to a live thread. Tagged `needs-approval`, so confirm scope with me first.                    |
| A3  | [#36](https://github.com/astahmer/dshfiles/issues/36) | b:108 Cmd+J / Ctrl+J toggle for the terminal                         | `workbench`                      | Small. Must not swallow keys while terminal input has focus. ⚠ OzakIOne already wrote "Prompting it right now".                                          |
| A4  | [#37](https://github.com/astahmer/dshfiles/issues/37) | b:183 remote-thread interaction parity                               | `multi-host`, `rich-composer`    | Large. Model/attachment pickers, workspace/JJ actions, approvals inside the controlling chat.                                                            |
| A5  | [#47](https://github.com/astahmer/dshfiles/issues/47) | b:588 duplicate edited-file summary after a turn                     | `turn-summary`                   | Small and well-specified. Native `ui-deliverables` card already shows it; keep the walkthrough + "Review in Changes". ⚠ Meiyo40 commented with evidence. |
| A6  | [#51](https://github.com/astahmer/dshfiles/issues/51) | b:597 right-panel toggle should close the only open panel            | `frame-layout` / `sidebar-right` | Small. ⚠ OzakIOne already wrote "Prompting it right now".                                                                                                |
| A7  | [#57](https://github.com/astahmer/dshfiles/issues/57) | b:609 Windows: DSH crashes at startup (dshx bridges on socket files) | `tooling/dshx`                   | Not UI, but a release blocker — someone should own it.                                                                                                   |

## B. Our GUI: concrete visual bugs (14)

Each has a screenshot on the item. These are the cheapest wins and the least likely to conflict with other work.

| #   | Item  | What's wrong                                                                                                                                                                                                                                      | Owner plugin                                    |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| B1  | b:607 | "Retry" / "Ask to fix" row after a failed turn still looks broken: the `RATE_LIMIT` badge is clipped and overlaps the error text, retry pill is off-grid.                                                                                         | `chat` (turn-error action seat)                 |
| B2  | b:554 | Composer action bar gets a weird width when the container is narrow.                                                                                                                                                                              | `rich-composer`                                 |
| B3  | b:638 | "Clean up workspaces" dialog rows are too tall — every row is sized for a title even when it shows one line.                                                                                                                                      | `jj-integration`                                |
| B4  | b:641 | Subagent rows in the transcript should be collapsible as one block, like the message queue.                                                                                                                                                       | `chat`                                          |
| B5  | b:620 | Subagent rows need a name / short truncated title of what they do; today they read "Subagent · Working".                                                                                                                                          | `chat`                                          |
| B6  | b:585 | Hovering the "1/5 subagents" counter jumps to the row and changes the label; probably unexpected. Needs a decision, then a fix.                                                                                                                   | `chat`                                          |
| B7  | b:581 | Mermaid flowchart renders incorrectly.                                                                                                                                                                                                            | `mermaid-diagrams`                              |
| B8  | b:556 | Opening a file from the resource list does nothing.                                                                                                                                                                                               | `editor` / `resource-packs`                     |
| B9  | b:145 | Screenshots render as text/links instead of images. Partially diagnosed: old replies wrapped links in code spans (unfixable in place); the rendering path itself is unverified.                                                                   | `tweet-context` / markdown render               |
| B10 | b:123 | Console noise + "signal failed" beside the workspace checkbox. Real error found: shortcut default conflict `commandPalette.newThread` vs `mainTabs.newTab`, plus a 404 on `changes.summary`.                                                      | `command-palette`, `main-tabs`, `workspace-nav` |
| B11 | b:469 | Unchecking the workspace checkbox in the New-thread composer leads to a broken state.                                                                                                                                                             | `workspace-nav`                                 |
| B12 | b:292 | "Broken workspace stuff": Backlog `startThreadForItems → jj-integration.provision` path, not the composer toggle. Not reproducible after a restart, and no Host-level test covers that orchestration. First step is a regression test, not a fix. | `backlog` + `jj-integration`                    |
| B13 | b:285 | Same class as B12/B14: the running Host held a stale bundle, so the visible bug may be code that is already fixed. Check `dshx status` before touching code.                                                                                      | build/Host state                                |
| B14 | b:387 | "Run perf opti again": blocked because the live Host boots an older bundle than the rebuilt plugins; the after-measurement is only valid after a Host restart (my decision, not yours).                                                           | `docs/performance.md`                           |

## C. The "what needs me" surfaces — the one coherent UX project (6)

This is the theme with the most user pain and the least design. Worth doing as one pass rather than six patches.

| #   | Item  | Ask                                                                                                                                      |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | b:603 | In the "Needs you" panel, "Other" is too vague: it says "we could land this" without saying what/where. Everything should be actionable. |
| C2  | b:601 | Activity timeline should show which agent did what, only the relevant parts — like an inbox.                                             |
| C3  | b:547 | Better inbox / activity timeline (reference: Vespin).                                                                                    |
| C4  | b:619 | "Needs you" timeline inspiration: aggregate questions across projects/machines, pre-ranked, answered by picking an option.               |
| C5  | b:606 | Too much noise, the app is overwhelming. Needs a redundancy audit more than a new feature.                                               |
| C6  | b:350 | "Frankenstein app": many plugins that don't always play nice with each other. Same audit, wider scope.                                   |

Suggested shape: one design pass over the inbox/attention surfaces (C1–C4) plus a noise inventory (C5–C6), then split
into small patches. Ownership: `activity-timeline` (panel, attention API, notifications), with `thread-sidebar` and
`backlog` for row-level content.

## D. Larger UI features with decisions pending (10)

| #   | Item                           | State                                                                                                                                                                                                                          |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | b:373                          | Workbench as the main view (dockable panels, plan `plans/workbench-main/README.md`, phases M0–M7). **Plan exists, not started, and the note says "do not start until the user says so".** Do not begin without an explicit go. |
| D2  | b:74                           | Same idea extended to the left sidebar, main view and tab header.                                                                                                                                                              |
| D3  | b:55                           | A "focused"/"zen" view with minimal UI.                                                                                                                                                                                        |
| D4  | b:135, b:147, b:75, b:76, b:77 | Keyboard layer: hold-⌘ tab numbers, Linear-style "more actions" palette, and tab open/close/reopen shortcuts that still don't work in the installed PWA.                                                                       |
| D5  | b:528 (+ b:527)                | "Point at your UI": element annotation → source file + markup for the agent (Tencil-like). We already own `annotations`; this is mostly wiring and UX.                                                                         |
| D6  | b:497, b:498, b:452            | Editor/diff stack: modern Monaco (or native), Pierre diffs/filetree, and renaming `pulls.review` into a "diffs review" plugin informed by codiff/lightjj.                                                                      |
| D7  | b:30, b:29                     | Source-control view: hover actions + batch selection (shift range, ⌘ multi), and readability vs VS Code's SCM (`jujutsu/src/source-control-view.tsx`).                                                                         |
| D8  | b:535, b:487                   | JJ revision graph: "loading older revisions" plus drag/interaction feel. Code for both landed (PR #29, `jj:84cfca76`); what's left is live re-verification after a rebuild and a drag/Host-profile investigation.              |
| D9  | b:576, b:461, b:71             | Graph beyond revisions: agent graph as a separate view, contributor avatars, the wheel-timeline animation idea.                                                                                                                |
| D10 | b:19, b:422, b:593             | Conversation surface: chat visualization (t3code/codex-like), a t3code-inspired redesign, and the open question of whether to rebuild "dsh web" (kabuki vs Foldkit vs classic React). D10 is a decision, not a task.           |

Two smaller product asks live next to these: b:20 (rich tweet rendering in Backlog) and b:618 (an image-only capture
should get a vision-model title instead of a raw `image.png`).

## E. Design / animation inspiration notes (unscheduled, ~45)

Nothing here should be picked up as "work" without a decision on which surface it applies to. Grouped by theme:

- **Traces / waterfall**: b:277, b:293, b:421, b:432, b:537 (also b:508, b:387 on the data side).
- **Agents, queues, subagents**: b:59, b:60, b:242, b:243, b:276, b:295, b:420, b:427, b:541, b:557, b:560, b:476.
- **Components & charts**: b:569 (gantt), b:571 (pie budget), b:573, b:580, b:584, b:586, b:599, b:478 (fallback chain), b:477 (composer nodes), b:527, b:524 (diffmap), b:564, b:565.
- **Layout & motion**: b:61, b:244, b:252, b:425, b:429, b:430, b:69, b:88, b:562, b:566, b:570, b:71.
- **Craft references / skills**: b:484, b:512, b:529 (unslop), b:50, b:15, b:548, b:7, b:17, b:62, b:53.
- **Adjacent product notes**: b:501, b:486, b:499, b:523, b:525, b:575, b:574, b:587, b:600, b:558, b:559, b:595.

## F. Not for a UI handoff (perf/infra, listed so you can ignore the noise)

b:643, b:642, b:636, b:637, b:632, b:631, b:630, b:627, b:626, b:624, b:622, b:621, b:616, b:617, b:640, b:639, b:633,
b:634, b:354, b:591, b:598, b:594, b:52, b:609 (release blocker, see A7), b:86 (see A2).

## G. Suggested order if you only have a day

1. B1, B2, B3 — retry/action-bar/row-height polish, all small and screenshot-provable.
2. B4 + B5 — the subagent row work is the same component; do it as one patch.
3. A5 (duplicate edited-file summary) and A1 (quote into composer) — both small, both upstream-facing.
4. B10 — the shortcut conflict is a real console error and cheap to fix.
5. Then read C1–C4 and come back with a design note, not code.

## Open questions for me (do not guess)

1. A2 (notification history) is tagged `needs-approval` — OK to start, or still parked?
2. B6 (subagent hover jump) — is the current behaviour intentional?
3. D1/D2 (workbench main view) — still "do not start", or unblocked now?
4. Which of E is a real direction versus just bookmarked inspiration?
