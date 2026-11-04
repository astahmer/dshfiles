# Phase 3b evidence (part A): the status-grouped thread list and the status strip

Captured 2026-11-04 from a scratch DSH (stock core 0.2.1-rc.2, every owned bundle, 77 loaded) built from the
`ade-3b-list` JJ workspace on top of `jj:wnvtzlmz` (main after Phase 3a). Same WebKit driver and sizes as the
[Phase 0 baseline](../baseline/README.md) and [Phase 3a](../phase3a/README.md): desktop 1440×900, phone 390×844 as
iPhone (scaled to 75 %), quantised PNG. No shot had document-level horizontal overflow (`scrollWidth = clientWidth`).

## Images

| Shot | What it shows | Compare with |
| --- | --- | --- |
| [30-threads-status-desktop](<30-threads-status-desktop.png>) | All threads grouped by status: Needs you (two failed turns, ✕ with "Turn failed." on the second line), Ready (bold, solid dot), Idle; working rows would spin without colour. The status strip along the bottom holds the Quota item (here "CC1 limit reached") | [10-threads-desktop](<../phase3a/10-threads-desktop.png>), [02-thread-list-desktop](<../baseline/02-thread-list-desktop.png>) |
| [31-group-menu-desktop](<31-group-menu-desktop.png>) | Group by: Status (default), Project, Date, **Arrange manually** (the older drag-to-arrange sections), None | — |
| [32-dark-threads-desktop](<32-dark-threads-desktop.png>) | The same list in dark mode | [baseline dark shots](../baseline/README.md) |
| [40-threads-status-phone](<40-threads-status-phone.png>) | Phone Threads tab: Needs you, Ready, Idle groups full width | [21-threads-list-phone](<../phase3a/21-threads-list-phone.png>) |
| [41-status-chip-phone](<41-status-chip-phone.png>) | Phone status strip collapsed to one **Status** chip, opened: only items with something to say are listed (Quota) | — |

## What changed

| Area | Before | Now |
| --- | --- | --- |
| Default grouping | Done view grouped by date; All threads by Pinned/Active/Parked/Inactive/Settled/Archived sections plus hoisted Interrupted/Needs resume/Usage limit/Approval/Input/Turn-finished groups | All threads by **Pinned · Needs you · Working · Ready · Idle · Done** (Done folded, auto-fold after 72 h idle unless pinned); sections stay as **Arrange manually**; saved views keep their grouping |
| Row emphasis | Coloured status dot and a coloured attention label per kind | Kit `StatusGlyph`; colour only for Needs you (accent ◆) and Failed (✕); Ready bold; Working colourless |
| Source of Needs you | Sidebar-only attention classification | Projection of the inbox (open `session` items) plus the sidebar's own classification |
| Inbox ↔ unread | Done in the Inbox left the row's unread dot | Done acknowledges the turn (`dshfiles/attention/done`), opening the thread resolves the item |
| Sidebar footer quota | Footer usage menu + preview strip above the footer | One Quota item in the frame's status strip (free docking keeps the preview seat) |
| Restart notice | Sidebar footer notice, Plugins row, Inbox item | + one "Restart pending" status item (no verb) |

## Unverified here

- **Subagent nesting with roll-up in the browser.** The fake provider's `subagent` call fails in scratch with the core
  tool-scheduler error seen in Phase 3a ("Cannot read properties of undefined (reading 'prepare')"), so no child
  thread could be seeded. The roll-up is covered by unit tests (`thread-status.test.ts`); nesting itself reuses the
  existing parent/child rows (`parentId` lineage).
- **Inline verbs on live inbox items** (Retry/Resume/Land through `act`): no provider item with those verbs was open in
  scratch; mapping covered by `inbox-signals.test.ts`.
- **Working rows and the "N working" item**: the fake provider fails every tool turn immediately, so no turn stayed
  running long enough to capture.

## Commands

```sh
export DSHX_DSH_EXECUTABLE="$(cd node_modules/@deepseek-ai/dsh && pwd -P)/lib/bin.js"
pnpm exec turbo run build --filter='./plugins/@dshfiles/*' --concurrency=4
D="node tooling/dshx/packages/dshx/dist/cli/bin.js dev"
$D up --name ade-3b-list --skip-build --fake-secret-cli --idle-timeout 120 --timeout 600000
$D open thread-sidebar/status-grouped-thread-list --name ade-3b-list
$D open ai-accounts/active-chat-account --name ade-3b-list      # fake-provider account + a failed turn
$D open thread-sidebar/usage-limit-group --name ade-3b-list     # quota-exhausted thread
$D open thread-sidebar/manual-unread --name ade-3b-list         # two more failed turns (its rename-dependent steps drift: the fake provider titles threads)
ADE_WS=$PWD node plans/ade-ux/phase3b/capture/phone.mjs <state.json> <out.png> light 1440x900 'click tab "Threads"' 'wait 2500'
# compression: magick <f> [-resize 75% for phone] -colors 128 PNG8:<f>
$D down --name ade-3b-list
```

`capture/phone.mjs` is the Phase 3a driver with one fix: `fill` values unescape `\"` and `\\`, so a fake-provider
prompt with JSON can be typed.
