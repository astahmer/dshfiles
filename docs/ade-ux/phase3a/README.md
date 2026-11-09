# Phase 3a evidence: the rail and destinations

Captured 2026-11-04 from a scratch DSH (stock core 0.2.1-rc.2, every owned bundle, 77 loaded) built from the
`ade-shell` JJ workspace on top of `jj:lkvzvqor` (Inbox providers on main). Same WebKit driver and sizes as the
[Phase 0 baseline](../baseline/README.md): desktop 1440×900, phone 390×844 as iPhone (scaled to 75 %), quantised PNG.
No page had document-level horizontal overflow (`scrollWidth = clientWidth` on all 20 shots).

## Images

| Shot | What it shows | Compare with |
| --- | --- | --- |
| [10-threads-desktop](<10-threads-desktop.png>) | Default: labelled rail (Threads selected) beside the thread list, Search threads, Board section | [02-thread-list-desktop](<../baseline/02-thread-list-desktop.png>), [01-start-thread-desktop](<../baseline/01-start-thread-desktop.png>) |
| [11-inbox-desktop](<11-inbox-desktop.png>) | Inbox opens its page directly (single section); badge on the rail | [05a-activity-desktop](<../baseline/05a-activity-desktop.png>) |
| [11-land-desktop](<11-land-desktop.png>) | Land: Workspaces, Review, History, Source control | [04b](<../baseline/04b-thread-integration-desktop.png>), [04c](<../baseline/04c-jujutsu-graph-desktop.png>), [04d](<../baseline/04d-pulls-review-desktop.png>) |
| [11-work-desktop](<11-work-desktop.png>) | Work: Backlog, Schedules | [05c-backlog-inbox-desktop](<../baseline/05c-backlog-inbox-desktop.png>) |
| [11-agents-desktop](<11-agents-desktop.png>) | Agents: Directory, Messages, Capabilities | — |
| [11-observe-desktop](<11-observe-desktop.png>) | Observe: Usage, Quota history, Quota forecast, Activity, Traces, Jobs, RAM, Hosts | [08a](<../baseline/08a-usage-desktop.png>), [08b](<../baseline/08b-ai-accounts-usage-desktop.png>), [05b](<../baseline/05b-jobs-desktop.png>) |
| [11-knowledge-desktop](<11-knowledge-desktop.png>) | Knowledge: Memory, Resources | — |
| [11-settings-desktop](<11-settings-desktop.png>) | Settings: All settings, AI accounts, MCP servers, Secrets, Plugins, Layout toggle | [07a](<../baseline/07a-ai-accounts-desktop.png>), [07d](<../baseline/07d-settings-desktop.png>) |
| [12-moved-page-desktop](<12-moved-page-desktop.png>) | A moved page opened: Observe › Usage in the stage | [08a-usage-desktop](<../baseline/08a-usage-desktop.png>) |
| [13-moved-to-desktop](<13-moved-to-desktop.png>) | "Where did a page go?" with Open per former entry | — |
| [14-collapsed-desktop](<14-collapsed-desktop.png>) | Collapsed: rail only, New thread on top, Inbox badge, Settings at the bottom | — |
| [15-board-desktop](<15-board-desktop.png>) | Threads › Board in the stage | [02b-thread-board-desktop](<../baseline/02b-thread-board-desktop.png>) |
| [16-free-docking-desktop](<16-free-docking-desktop.png>) | Settings › Layout › Free docking: the old Dockview left column and its saved layout return | every baseline desktop shot |
| [17-back-to-fixed-desktop](<17-back-to-fixed-desktop.png>) | Palette "Layout: fixed" restores the rail | — |
| [20-stage-phone](<20-stage-phone.png>) | Phone stage, full width, bottom tab bar | [01-start-thread-phone](<../baseline/01-start-thread-phone.png>) |
| [21-threads-list-phone](<21-threads-list-phone.png>) | Threads tab: the list full screen | [02-thread-list-phone](<../baseline/02-thread-list-phone.png>) |
| [22-inbox-phone](<22-inbox-phone.png>) | Inbox tab opens the Inbox page | [05a-activity-phone](<../baseline/05a-activity-phone.png>) |
| [23-more-phone](<23-more-phone.png>) | More: the other destinations and the moved-to help | — |
| [24-observe-index-phone](<24-observe-index-phone.png>) | Observe's section list full screen | — |
| [25-moved-page-phone](<25-moved-page-phone.png>) | Observe › Usage pushed on the stage | [08a-usage-phone](<../baseline/08a-usage-phone.png>) |

## Baseline defects fixed

| # | Defect (baseline) | Now |
| --- | --- | --- |
| 1 | Three stacked Dockview strips with truncated titles in the left column | Gone in the default layout; Dockview only with Layout › Free docking |
| 2 | Icon rail is a horizontally scrolled strip without labels | Fixed vertical rail of 8 labelled destinations; tooltips only when collapsed |
| 3 (part) | Plugin-prefixed page names in navigation ("pulls.review: Reviews") | Sections drop the prefix ("Land › Review"); palette rows read "Observe › Usage". Workbench tab titles still carry prefixes (3b) |
| 4 | Phone keeps the desktop shell and a 56 px rail | Bottom tab bar (Threads, Inbox, New, More); stage takes the full width |
| 5 | Thread list unreachable on phone without squeezing the stage to ~190 px | Threads tab opens the list full screen; opening a thread pushes the stage |
| 21-entry nav | 21 left-nav entries (inventory §4) | 8 rail entries; every old page is a section or palette row, listed in "Where did a page go?" |
| 20 (part) | Counters disagree | The rail shows one badge, the Inbox's own Needs you count; no other nav badge |

Not addressed here (later phases): thread list status grouping and nesting (3b), centre tab chrome and duplicate tabs
(3b/4), the composer chips (4), page bodies (Phase 1b, other agents), phone facets as sheets and safe-area polish (6).

## Commands

```sh
export DSHX_DSH_EXECUTABLE="$(cd node_modules/@deepseek-ai/dsh && pwd -P)/lib/bin.js"
pnpm exec turbo run build --filter='./plugins/@dshfiles/*' --concurrency=6
D="node tooling/dshx/packages/dshx/dist/cli/bin.js dev"
$D up --name ade-shell --skip-build --fake-secret-cli --idle-timeout 120 --timeout 300000
$D open home/home-screen --name ade-shell                     # seed: rebase-ready thread
$D open user-questions/answered-question-stays-closed --name ade-shell   # seed: fake-provider threads (see below)
bash capture/shots.sh desktop; bash capture/shots.sh phone      # WebKit, writes raw/
# compression: magick <f> [-resize 75% for phone] -colors 128 PNG8:<f>
$D down --name ade-shell
```

The `user-questions` seed creates its account and thread through the rail, then stops at an unrelated Host tool error
(`bash`: "Cannot read properties of undefined (reading 'prepare')"); the threads it made are in the shots. The
`rebase-ready-thread` seed only passes on a fresh instance (it assumes the New thread screen, not an open thread).
