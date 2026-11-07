# Phase 6 evidence: the same product on an iPhone

Plan: [ADE plan](../README.md) §8 phase 6 ("Bottom tabs, stack navigation, facets as sheets, safe-area and `dvh`,
keyboard-safe composer, touch equivalents for hover actions"; acceptance "no horizontal overflow at 390×844 in WebKit
for every destination; the journeys pass on phone"), with prior-art §3.2 (mobile rules) and the
[Phase 0 phone defects](../baseline/README.md#observed-defects).

Captured 2026-11-05 in scratch DSHs (stock core 0.2.1-rc.2, every web-profile bundle) built from the `ade-phone` JJ
workspace on top of `jj:main` after Phase 5b (`before/` was captured on the pre-5b main; the desktop "before" on the
post-5b main in a temporary workspace). Phone = Playwright **WebKit**, 390×844, `isMobile`, touch, iPhone Chrome UA,
2× then scaled to 75 %; desktop = WebKit 1440×900. iPhone Chrome is WebKit, so that is the engine that matters
(memory n:2). Images are 128-colour PNGs.

## What changed

| Owner | Change |
| --- | --- |
| `thread-sidebar` | **Stack navigation.** A phone top bar (44 px + safe area) names the screen; **Back** pops one level: a thread → Threads, a thread opened from an Inbox item → Inbox, a page → its destination list, a destination opened from More → More; Threads and Inbox lists are tab roots. On a thread it offers **Thread panels** (the sheet). Title follows the live stage Session (a draft that became a thread, a rename). Tapping the row already on stage closes the list. Keyboard: `visualViewport` publishes `data-phone-keyboard`/`--dsh-keyboard-inset` (tab bar hides, stage ends on the keyboard) and `--dsh-visual-offset-top`. `viewport-fit=cover` while the phone shell is mounted. Back opens are counted (navigation surface `back`). **Touch row menu:** on a coarse pointer every thread row has a ⋯ that opens the row's own menu (all hover actions); the hover strip is hidden there and the inline verb moves left of ⋯ |
| `frame-layout` (native fork, recorded delta files) | Phone frame sits between the bars on `100dvh` (a relative `top`, not `margin-top`, which collapsed and made the document 44 px scrollable); the stage shrinks to the keyboard; the phone document does not scroll or rubber-band. The status strip leaves the grid: one 44 px **Status** dot in the top bar's trailing corner, its list opening under the bar |
| `workbench` | The dock (thread panel) is a **bottom sheet** on a phone: same surface, facet tabs and Choose a view, grab handle, Close, scrim, Escape. Its open state is page-local (every phone load starts closed) and every dock control drives it on a phone, so the remembered desktop right pane is neither opened over a phone nor changed from one. Main tab rows hidden on a phone with the phone shell; chooser search no longer autofocuses on touch (no surprise keyboard) |
| `plugin-ui` | Coarse pointer: kit buttons, toggles and toggle-group items get a ≥ 44 px hit area through `::after` (page tabs through `::before`), menu/select/command rows get 44 px rows. Drawn size and layout unchanged; desktop (fine pointer) untouched |
| `settings-shell` | Narrow pane: native General rows wrap (text needs 12rem before its control) instead of squeezing labels to one word per line |

Desktop is unchanged by construction (every rule is behind `max-width: 639.98px` + `data-shell-phone-nav`, `pointer:
coarse`, or a narrow container) and by evidence below.

## Audit: before → after (390×844 WebKit)

Driver: [`capture/audit.mjs`](capture/audit.mjs) with [`capture/audit-plan.json`](capture/audit-plan.json): one WebKit
iPhone context walks every destination, a thread stage, both composers, every thread facet, the row menu, the
keyboard and the status chip, and measures document overflow, elements past the viewport edge, clipped text, controls
whose **hit area** is under 44 px, hover-only controls and `scrollY`. Reports:
[before](before/audit-report-phone.json), [after](after/audit-report-phone.json).

| Screen | Doc width | Tap targets < 44 px | Hover-only | Before | After |
| --- | --- | --- | --- | --- | --- |
| Threads list ¹ | 390 → 390 | 37/43 → 52/69 | 9 → 0 | [before](before/01-threads-phone.png) | [after](after/01-threads-phone.png), [row menu](after/01b-row-menu-phone.png) |
| Thread stage | 390 → 390 | 34/42 → 28/38 | 0 → 0 | [before](before/02-thread-stage-phone.png) | [after](after/02-thread-stage-phone.png) |
| Thread panel sheet (Changes, Cost, Jobs, Context) | — → 390 | unreachable → 33/85 … 39/54 | — → 0 | only via main pane New tab | [sheet](after/02b-panels-sheet-phone.png), [Changes](after/02c-facet-changes-phone.png), [Cost](after/02d-facet-cost-phone.png), [Jobs](after/02e-facet-jobs-phone.png), [Context](after/02f-facet-context-phone.png) |
| Composer, keyboard open | — → 390 | — → 10/12 | — | — | [after](after/03-composer-keyboard-phone.png) |
| New thread composer | 390 → 390 | 19/23 → 10/16 | 0 → 0 | [before](before/04-composer-new-phone.png) | [after](after/04-composer-new-phone.png) |
| Inbox | 390 → 390 | 14/18 → 0/8 | 0 → 0 | [before](before/05-inbox-phone.png) | [after](after/05-inbox-phone.png) |
| More / Land list | 390 → 390 | 21/25 → 7/15; 15/23 → 0/14 | 0 → 0 | — | [More](after/06-more-phone.png), [Land](after/07-land-phone.png) |
| Land › Workspaces | 390 → 390 | 12/16 → 1/7 | 0 → 0 | [before](before/07b-land-workspaces-phone.png) | [after](after/07b-land-workspaces-phone.png) |
| Work › Backlog | 390 → 390 | 36/40 → 24/31 | 0 → 0 | [before](before/08b-work-backlog-phone.png) | [after](after/08b-work-backlog-phone.png) |
| Agents › Directory | 390 → 390 | 20/32 → 8/23 | 0 → 0 | [before](before/09b-agents-directory-phone.png) | [after](after/09b-agents-directory-phone.png) |
| Observe › Usage | 390 → 390 | 30/57 → 1/50 | 0 → 0 | [before](before/10b-observe-usage-phone.png) | [after](after/10b-observe-usage-phone.png) |
| Observe › Processes | 390 → 390 | 34/38 → 3/29 | 0 → 0 | [before](before/10c-observe-processes-phone.png) | [after](after/10c-observe-processes-phone.png) |
| Observe › Traces | 390 → 390 | 27/34 → 5/25 | 0 → 0 | [before](before/10d-observe-traces-phone.png) | [after](after/10d-observe-traces-phone.png) |
| Knowledge (Memory) | 390 → 390 | 25/29 → 7/20 | 0 → 0 | — | [after](after/11-knowledge-phone.png) |
| Settings | 390 → 390 | 21/42 → 7/33 | 2 → 2 | [before](before/12-settings-phone.png) | [after](after/12-settings-phone.png) |
| Status chip | — | — | — | separate 24 px row | [after](after/13-status-chip-phone.png) |

All 29 after-screens: document `scrollWidth` 390, 0 elements past the edge, 0 clipped, `scrollY` 0, no page errors.

¹ The after list shows six seeded threads instead of two, and the counts include the stage's controls under the
full-screen list (they are laid out, only covered); the list rows themselves are full-width 50 px buttons. Most
remaining small targets on thread screens are the native conversation header and composer chips (see Residual).

## Defects: before → after

| # | Defect (audit, before) | After |
| --- | --- | --- |
| P1 | No Back: the stage pushed over the list could only be left through a tab | Top bar with Back to the list it came from (Threads, Inbox, a destination list, More) |
| P2 | Desktop tab strip on every phone stage ("× New thread ● × Fake thread title + ⌄3 ⋯"), 28 px targets | Hidden on phone; the stack and the sheet navigate |
| P3 | Thread facets (Changes, Cost, Jobs, Context) only through the main pane's New tab, replacing the thread | Bottom sheet from Thread panels or the existing right-pane toggle |
| P4 | Status strip took its own 24 px row between stage and tab bar | 44 px Status dot in the top bar |
| P5 | Hover-only row actions (Open in side panel, Pin, Mute, Archive…), and iOS fires no contextmenu on long press | Touch ⋯ per row opens the full row menu |
| P6 | Tap targets: most kit controls 24–32 px | Kit hit areas ≥ 44 px on a coarse pointer (counts above); menu rows 44 px |
| P7 | No safe-area handling (`viewport-fit` unset, bars at the raw edges) | `viewport-fit=cover` with insets on top bar, tab bar, sheet and status dot |
| P8 | Frame height from `100%`; keyboard would hide the composer behind it on iOS | `100dvh`; `visualViewport` shrinks the stage to the keyboard and hides the tab bar ([shot](after/03-composer-keyboard-phone.png)) |
| P9 | Settings rows squeezed labels to one word per line | Rows wrap; control under the text |
| P10 | Destination list repeated the top-bar title; Inbox named "Needs you"; Settings shown as a thread | Fixed (heading kept for assistive tech; Inbox and Settings named) |
| P11 | (found while fixing) the first frame offset made the document 44 px scrollable; any focus/scroll-into-view shifted bars and stage | Relative `top` + no document overscroll; `scrollY` 0 everywhere |
| P12 | (found while fixing) sharing the remembered desktop right-pane state would open the sheet over a phone and close a desktop pane from the phone | Page-local sheet state; [desktop after phone runs](desktop/d1-threads-after-phone-runs.png) keeps its pane closed |

## Phone journey (WebKit 390×844)

Scripted driver check (the Gherkin harness is Chromium 1440×900 only): [`capture/journey-plan.json`](capture/journey-plan.json)
run with `--strict` (exit 1 on any failed step). It seeds its own question thread from the phone composer, with a
per-run nonce because the fake provider runs each `[[once …]]` text once. Report: [journey](after/journey-report-phone.json).

| Step | What it proves | Result |
| --- | --- | --- |
| j0 | New thread from the tab bar, send a message that asks a question | pass |
| j1 | Open a thread from Threads (Needs you row); list closes; Back to Threads shown ([shot](after/j1-open-thread-from-threads-phone.png)) | pass |
| j2 | Answer the question in the thread (option + Submit) | pass |
| j3 | Send a message from the started composer ([shot](after/j3-send-message-phone.png)) | pass |
| j4 | Open the Changes facet in the bottom sheet ([shot](after/j4-changes-sheet-phone.png)); close it | pass |
| j5 | Inbox: the finished turn is an item; Open it → thread with Back to Inbox ([shot](after/j5-inbox-open-item-phone.png)) | pass |
| j6 | Back to Inbox ([shot](after/j6-back-to-inbox-phone.png)) | pass |
| j7 | Mark the item Done; it is under Done | pass |
| j8 | More › Land › Workspaces, Back to Land, Back to More ([shot](after/j8-back-through-more-phone.png)) | pass |

Exit 0, 10/10 screens, no overflow, `scrollY` 0. The Inbox item is a finished turn ("Other"): the native
`ask_user_question` Inbox provider produced no item in scratch for either untimed or timed forms (Phase 2 gap, below),
so "answer" is proven in the thread card and the Inbox step uses Open/Back/Done.

## Desktop unchanged

Same [`capture/desktop-plan.json`](capture/desktop-plan.json) on `main` and on this branch, WebKit 1440×900:
[thread before](desktop/d2-thread-stage-before.png) / [after](desktop/d2-thread-stage-after.png),
[settings before](desktop/d5-settings-before.png) / [after](desktop/d5-settings-after.png): same rail, tab strip,
status strip and right-pane toggle; no top bar, no row ⋯ on a fine pointer. Differences are data only (the branch
scratch has more seeded threads). Desktop e2e: see the final report.

## Not done / residual

- Tap targets still under 44 px come from native or forked controls the kit rule does not reach: the conversation
  header (Open in Finder 23 px, workspace chip 28 px), the composer run row chips (28 px) and the native Settings font
  stepper, which is also hover-only (`dsh-client-ui-theme`, core).
- No browser-history entry per stack level: the iOS back swipe still moves between threads (navigation history), not
  list ↔ stage.
- The facet tab a scratch restart orphaned showed "… is not available" in the sheet until picked again (Workbench
  facet rebind after a Host restart, also desktop; not investigated).
- A frame-layout HMR reload in scratch once left a blank WebKit page (`renderSlot('root') before any 'root'
  registration`); a manual reload recovered. Not reproduced on purpose.
- Native question forms do not reach the Inbox in scratch (Phase 2 gap).
- Not tested on a physical iPhone: safe-area insets, the real software keyboard (simulated by stubbing
  `visualViewport.height`), rubber-banding and the back swipe.

## Commands

```sh
export DSHX_DSH_EXECUTABLE="$(cd node_modules/@deepseek-ai/dsh && pwd -P)/lib/bin.js"
pnpm exec turbo run build --filter='./plugins/@dshfiles/*'
D="node tooling/dshx/packages/dshx/dist/cli/bin.js dev"
$D up --name ade-phone --skip-build --fake-secret-cli --idle-timeout 240 --timeout 400000
$D open user-questions/answered-question-stays-closed --name ade-phone        # seed: fake-provider threads
S=$TMPDIR/dshx-dev/ade-phone/state.json
ADE_WS=$PWD node docs/ade-ux/phase6/capture/audit.mjs $S out docs/ade-ux/phase6/capture/audit-plan.json
ADE_WS=$PWD node docs/ade-ux/phase6/capture/audit.mjs $S out docs/ade-ux/phase6/capture/journey-plan.json --strict
ADE_WS=$PWD node docs/ade-ux/phase6/capture/audit.mjs $S out docs/ade-ux/phase6/capture/desktop-plan.json --desktop
$D down --name ade-phone
# compression: magick <f> -resize 75% -colors 128 PNG8:<f>   (desktop: 50%)
```
