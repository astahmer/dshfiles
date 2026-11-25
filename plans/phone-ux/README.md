# Phone UI/UX: research and improvement plan

**Resume here:** research done (2026-11-17), nothing built. The owner picks tracks from [Ranked backlog](#ranked-backlog);
each picked item gets its own revision, scratch before/after shots at 390 px, and a real-phone check when
[real-phone verification](../real-phone-verification/README.md) is set up.

## Progress (2026-11-25)

Audit rerun against the live Host (started 2026-11-23 21:28) at 390×844, Android UA, touch, DPR 2, in headless
Chromium. Cold first load to usable composer: 20.2 s in this harness (not comparable with the 4×-throttled 7.0 s
below until the same throttling is applied). Still reproduce:

1. **P5** — picking Inbox in the drawer keeps the drawer open and shows the Inbox section list (Needs you / Waiting
   threads). Picking a thread does close the drawer, and system Back closes the drawer without leaving the page.
   Opening a destination straight on its content is still a design choice: which section, and how the other section
   stays reachable.
2. **P6** — the composer `+` picker opens a 343×95 dropdown whose listbox background is transparent (rgba(0,0,0,0))
   with a loading skeleton and no rows in the harness; Escape handling could not be measured because the menu never
   settled.
3. **P29** — phone destination lists drew the page description under the top bar (which already names the page) and
   descriptions on section rows, both truncated at 390 px.
4. **P31** — the launch log still warned that `mainTabs.newTab` and `commandPalette.newThread` claimed Mod+T together.

Shipped in the `thread-1a2f07` workspace (not on main yet):

1. **P31a** — the workspace segment read `Own workspacefrom main`; the two flex spans now carry a real space, so the
   composer summary is `Own workspace from main`.
2. **P31b** — `mainTabs.newTab` no longer claims Mod+T on desktop (kept the web binding), so `newThread` registers.
3. **P29** — phone lists keep the page heading for assistive tech only, omit the page description, and render rows
   without descriptions; covered by a focused test.
4. **P6 (partial)** — the picker now paints the menu surface (it computed to `rgba(0,0,0,0)`), gives rows 44px and
   18px glyphs on the phone rule, and Escape dismisses it from the document, so a tap on `+` no longer leaves the key
   unanswered. The kit's existing phone-sheet rule now lists the picker's `[data-menu-material][data-trigger-menu]`
   surface, so it rises as the app sheet (surface, grabber, scrim, 72dvh cap) instead of a 343×95 dropdown. Still open
   on P6: 48px rows (waits for the 44→48 decision) and files/threads before skills.
5. **P28** — the phone shell hides `KeyHint` and the menu shortcut slots under 640px: no keycaps without a keyboard.
6. **P7 not reproduced** (2026-11-25 live check): the context meter panel opened at x114 y577, 264×159 in a 390×844
   viewport. Keep it open as a regression check rather than a fix.
7. **P4 (partial)** — the kit gained `useCloseWatcher` (tested) and the composer picker plus the context meter adopt it, so
   the system back gesture closes them instead of leaving the thread. Still open: every other popover and sheet.
8. **P32 (partial)** — the open phone drawer traps Tab through the kit dialog focus hook and returns focus on close;
   21 drawer journey tests pass. Still open: `inert` on the stage, reduced motion everywhere, large-text check.
9. **P15 (partial)** — the phone thread-panel sheet resumes the last real view instead of opening on the chooser, with
   the selection logic covered by 3 tests. Still open: unmounting hidden dock views.
10. **P27** — on a coarse pointer the thread row menu offers Keep screen on / Allow screen to sleep: one page-level
    Screen Wake Lock, re-requested when the page becomes visible while wanted, off when the platform refuses. 4 tests;
    the real-phone check (does the screen stay on) is still the owner's.
11. **P20 (partial)** — a coarse pointer gets a key row above the terminal (Esc, Tab, Ctrl+C, arrows) that sends the
    bytes through xterm and keeps focus; hidden on pointer devices, disabled while not writable. 2 tests. Still open:
    follow tail / jump to latest / search / copy for logs.

Verification limit: a full `dshx dev up` build of every owned plugin ran the live Host out of resources and it
restarted at 2026-11-25 11:17. Do not repeat a whole-workspace build plus a second DSH while the live instance runs;
build only the touched plugin and prefer focused tests, or run the scratch instance with its own plugin subset.

### Verified on a scratch DSH (2026-11-25, this workspace)

Built only the seven touched plugins (`--concurrency=2`), booted `dshx dev up --name phone --skip-build`, drove it with
Playwright at 390×844 (Android UA, touch):

1. **P6 sheet** — the picker is a viewport sheet: x0, y721, h123, bottom gap 0, width 390, 16px top radius, opaque
   surface (`oklch(0.945 0.0035 65)`), grabber visible; Escape closes it. Before: a 343×95 transparent dropdown at
   y581 inside the composer card. Evidence: `phone-fix-audit/b04-picker-plus.png` (before) and
   `phone-fix-audit/a02-scratch-picker.png` (after).
2. **P29** — the Inbox page shows the top-bar title, then `Needs you` / `Waiting threads` with no page description and no
   row descriptions. Evidence: `phone-fix-audit/b02-inbox-after-pick.png` (before) and
   `phone-fix-audit/a04-scratch-inbox.png` (after).
3. **P31b** — no `mainTabs.newTab` / `Conflicting shortcut defaults` warning in the scratch console.
4. P4's back gesture, P28 keycaps and P32 focus were not exercised on the scratch phone (no thread with a menu there);
   their proofs stay unit-level for now.

### Code sweep (2026-11-25): already present, no work left

A pass over the owners after the restart shows most Tier 2/3 items already shipped by other lanes. Present in code,
not re-checked on a phone:

1. **P10** — `InputBar.tsx` resolves send, queue, steer and stop modes; `canSteerQueue` and the queue dock's per-row
   steer exist.
2. **P13 (except landing preference)** — `ChatView.tsx` has `jumpToTurn`, the Since-you-left card with jump/dismiss and
   the older-rows sentinel; the first-unread-vs-newest landing stays the owner's decision.
3. **P14** — `inbox-panel.tsx` has `InboxSwipe` (left Done, right Snooze), Done/snooze views and presets.
4. **P9 (partial)** — `chat/ApprovalCommand.tsx` renders approvals inline, and `agent-questions` has the parent
   question path (`parent-questions.test.ts`); subagent requests reaching the parent needs a live check.
5. **P30** — the phone thread menu is a labeled bottom sheet with submenus at one level; its only leak was keycaps,
   which P28 hides.
6. **P26** — the phone shell sets `viewport-fit=cover` and pads the drawer, top bar, sheet and tab bar with the
   safe-area insets.
7. **P25 (partial)** — the transcript owns `overscroll-behavior` (`ChatView.module.css`); the
   `interactive-widget=resizes-content` half waits for a real-phone keyboard check.
8. **P15 (partial)** — `PhoneSheet` already has one header, a 44px close, focus trap, back-gesture layer and drag; the
   chooser default is fixed (see P15 in the shipped list) and the dock now resumes its last real view. Unmounting
   hidden dock views is still open (Dockview keeps every panel mounted).


Goal: DSH on a phone (owner: Redmi, HyperOS, Android Chrome PWA over Tailscale HTTPS, ~393 CSS px, gesture navigation)
feels as smooth and obvious as the best phone apps, for driving many agent threads: switch, read, steer, approve, land.

Related plans: [phone push notifications](../phone-push-notifications/README.md) (push design, quiet hours),
[real-phone verification](../real-phone-verification/README.md) (adb/CDP on the Redmi), [ADE UX](../ade-ux/README.md).

## How this was researched

Five read-only tracks, 2026-11-17. Claims carry a source; **B** marks best-effort claims from memory, not re-fetched
(web search was unavailable, so known URLs were fetched directly).

1. AI chat and coding-agent phone apps: t3code, Happy, Claude Code remote/mobile, ChatGPT/Codex, Cursor iOS, GitHub
   Mobile Copilot, Replit, Le Chat, VibeTunnel, Omnara.
2. Messaging: Discord, Slack, Telegram, Zulip (first-party); WhatsApp, Signal, iMessage, Teams (B).
3. Developer and productivity tools: GitHub Mobile and inbox, Linear, Working Copy, GitLab, Blink, Termius, VS Code
   tunnels; Gmail, Todoist, Things, Superhuman (B).
4. Platform: Material 3, Apple HIG, Android predictive back and edge-to-edge, web APIs with Chrome Android / iOS support
   (MDN browser-compat-data 8.1.9, 2026-11-12).
5. Audit of the live DSH at 393×851 (touch, Android UA) with a 4× CPU / 100 ms RTT timing pass; screenshots in
   `/Users/astahmer/dev/dshfiles-threads/phone-ux-audit/` (outside the repo). The live Host was still on code from
   2026-11-13 with ~46 rebuilt plugins pending a restart, so items marked ⟳ must be re-checked after a restart.

## What the best apps do (condensed)

| Area | Pattern | Seen in |
|---|---|---|
| Navigation | One primary system only; Discord dropped its Android drawer because it fought the system back gesture, moved to a bottom bar plus panels swiped from most of the screen | [Discord](https://discord.com/blog/how-discord-made-android-in-app-navigation-easier), [You Bar](https://discord.com/blog/you-bar) |
| Navigation | Phone: list is the root, pages push; one layout layer decides by width; horizontal scrollers must not eat back/drawer swipes | [t3code mobile-layout](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/internals/mobile-layout.md), [mobile-navigation](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/internals/mobile-navigation.md) |
| Back | System back closes the top sheet/drawer/popover first (CloseWatcher, `<dialog closedby>`), never leaves the page with a layer open | [predictive back](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture), MDN BCD |
| Thread list | Sections Pinned / Active / Working / Snoozed / Settled; a thread jumps back up when it finishes, fails or needs approval; snooze presets; 5 s undo | [t3code thread-sidebar](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/user/thread-sidebar.md) |
| Thread list | Swipe to archive; archived item resurfaces on a new event unless muted; long-press to multi-select with a thumb-height action bar; "Draft:" in the row | [Telegram archive](https://telegram.org/blog/archive-and-new-design), [Zulip drafts](https://zulip.com/help/view-and-edit-your-message-drafts) |
| Attention | One feed of everything that needs you; act in place (reply/approve), which marks it read; Clear keeps a reopenable filter; Done is a view, not a delete | [Slack Activity](https://slack.com/help/articles/19693583638803), [GitHub inbox](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox), [Linear inbox](https://linear.app/docs/inbox) |
| Approvals | Approval cards in the transcript; subagent approvals shown in the parent; typing a reply = decline with feedback; prompts never time out into a default; no bypass mode from the phone | [t3code permission-modes](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/user/permission-modes.md), [Claude remote-control](https://code.claude.com/docs/en/remote-control.md) |
| Composer | Send shows Queue vs Steer while a turn runs, long-press does the other; queued messages editable / "send now"; large paste → attachment; voice dictation inserted at the cursor; share-sheet into a thread; picker commands take arguments (`/model x`) | [t3code composer](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/user/composer.md), [Claude mobile](https://code.claude.com/docs/en/mobile.md) |
| Composer | Most-used actions on the right near the thumb, the rest behind **+**, long-press **+** for shortcuts | [Discord](https://discord.com/blog/improving-mobile-with-squircles-styles-and-spacing) |
| Messages | Per-message send state: pending → acknowledged → failed with retry/cancel; auto-resend on reconnect; partial output kept on disconnect with the error inline | [Zulip](https://zulip.com/help/verify-your-message-was-successfully-sent), [GitHub Mobile](https://docs.github.com/en/get-started/using-github/github-mobile) |
| Reading | Open at first unread or newest (setting); jump-to-latest with a count; scrolling never auto-acknowledges answers | [Zulip where you land](https://zulip.com/help/configure-where-you-land) |
| Diffs | Stacked only on phones; word-wrap toggle; one file at a time with a file sheet; generated/huge files collapsed; tap a diff line to quote it to the agent | [GitLab](https://docs.gitlab.com/user/project/merge_requests/changes/), [Working Copy](https://workingcopy.app/manual/), [Linear](https://linear.app/changelog) |
| VCS | Compact one-line graph rows; swipe/long-press verbs; destructive swipe only on unpushed revisions; undo for history edits | [Working Copy](https://workingcopy.app/manual/) |
| Terminal / logs | Key row above the keyboard (Esc, Ctrl, Tab, arrows), hidden with a hardware keyboard; follow tail, jump to latest, search, copy | [Blink](https://docs.blink.sh/) |
| Notifications | Separate toggles for needs-you and turn-done (never / background only / always); no push while at the desk; action buttons; quiet hours | [ChatGPT notifications](https://learn.chatgpt.com/docs/notifications.md), [Claude mobile](https://code.claude.com/docs/en/mobile.md), [Linear](https://linear.app/mobile) |
| Perf | Gestures off the busy main thread; stop off-screen animations (a hidden spinner cost Discord 10% CPU); never remount the composer on switch (2 s freeze); virtualized rows; lazy sheets | [Discord RN perf](https://discord.com/blog/how-discord-achieves-native-ios-performance-with-react-native) |
| Scope | The phone is not an IDE: config stays on desktop | [Cursor mobile](https://cursor.com/docs/cloud-agent/mobile) |

Web platform capabilities worth using (support from MDN BCD 8.1.9; CA = Chrome Android, iOS = Safari/Home Screen):

| API | Use | CA | iOS |
|---|---|---|---|
| CloseWatcher / `dialog closedby` | Back closes the top layer | 126 / 134 | 27.3 beta |
| Notification `actions` + `launch_handler` | Approve/Deny/Open from a push, reuse the open window | 48 / 110 | no |
| Share Target (`share_target`) | Share screenshots/text into a thread | 76 | no |
| Manifest `shortcuts` | Long-press icon: New thread, Inbox | 84 | no |
| Badging | Needs-you count on the icon | no | 16.4 (Home Screen) |
| `interactive-widget=resizes-content` | Keyboard shrinks the layout without JS | 108 | 27.3 beta |
| `overscroll-behavior: contain` | No scroll chaining from sheets/drawer | 63+ | 16 |
| Web Speech / `getUserMedia` | Voice input | 139 / 53 | prefixed 14.5 / 11 |
| Screen Wake Lock | Keep screen on while watching a run | 84 | 18.4 |
| View Transitions (same document) | Animated list ↔ thread, sheet morphs | 111 | 18 |
| `content-visibility: auto` | Cheaper long transcripts | 85 | 18 |
| `viewport-fit=cover` + safe-area | Edge-to-edge bars | yes | yes |

## Where DSH stands (audit, 2026-11-17)

Works well (keep): bottom sheets with grab handle and 44 px rows; drawer slide (320 ms at 4×); no page-level sideways
overflow; Land/Changes skeletons; AI accounts cards; Getting started; Inbox answer-in-place cards; Notifications filter.

Measured (4× CPU, 100 ms RTT, machine load ~12; Host lag p99 16 ms, so costs are in the browser):

| Metric | Value |
|---|---|
| First load → composer usable | 7.0 s, one 2.4 s long task, 12 long tasks = 5.55 s |
| Thread switch (drawer mode) | title 1.3–2.2 s, first message 1.9–2.5 s, 10–16 requests, 2.2–3.0 s long tasks (max 877 ms) |
| Panel sheet first open | 2.2 s (opens a "Choose a view" chooser) |
| Context view open | 55 requests, 3.5 s long tasks |
| Session log view | 1.8 s long tasks |
| DOM size | Notifications 9.5k, Backlog 11k, panel views ~7k (all kept mounted) |

Stack-mode baseline on 2026-11-13 ([performance.md](../../docs/performance.md)) was tap → title p50 1037 ms; today's
numbers need a same-setup rerun before calling it a regression.

Top problems by user impact (evidence file names under the audit folder):

1. Thread switch and first load are slow on a mid-range phone (above).
2. ⟳ Drawer stays open after picking Inbox › Needs you or a More page (`61-…`, `71…75`).
3. ⟳ Context meter popover opens at y = −20878, off screen (`23b-…`).
4. ⟳ Composer `+` / `/` / `@` pickers are see-through, ignore Escape, 34 px rows, 69 items, skills before files/threads (`20-…`, `85-…`, `86-…`).
5. Blank 324 px band over the transcript bottom from the subagent dock seat (`14`, `15b-…`; maybe headless-only).
6. Panel sheet: two tab rows, chooser by default, every opened view stays mounted, 20 px close buttons (`40-…`).
7. Targets under 44/48 px across composer (+, ⋯, meter, Send 36, usage pill), header (36×32), chips, switches (24×14), picker detail buttons (16–18 px).
8. Truncation hides the key info: thread titles (~20 chars) behind a machine/path line, "Claude O…", file paths cut at the file name (`01-…`, `14-…`).
9. Inbox and Land open a sub-page menu instead of content (extra tap; badge overlaps text).
10. Notifications/Backlog/panel views keep everything mounted; notifications one row per event, 500 unread, no grouping.
11. Desktop leaks: shortcut hints (⌘K, ^R, ⌘1–8, P/E/H, ⌘Enter), "Open in side panel", desktop palette dialog, dense Hosts form, crowded Land rows and cut chips.
12. Transcript opens mid-thread with Back to bottom showing; loading older pages leaves a blank gap.
13. Tables wider than the screen: Session log (660 px, 11 px text), Usage (1050 px).
14. Repeated page titles plus description paragraphs on every page; raw Markdown in Inbox previews.
15. Thread menu sheet: unlabeled 28 px icon row, three levels deep, conflicting subagent counts.
16. Settled threads still show a spinner in the composer status.
17. "Own workspacefrom main" (missing space); shortcut conflict `mainTabs.newTab` vs `commandPalette.newThread`.

Owner-reported and still open: `+` menu labels and image chips with missing text on the Redmi (suspected variable-font
rendering; test with a system font), Quote/Annotate vs the HyperOS selection toolbar.

## Ranked backlog

Impact for the owner's phone workflow first, then effort. Each item: owner plugin, acceptance check.

### Tier 1: friction every session

| # | Item | Owner | Acceptance |
|---|---|---|---|
| P1 | Re-run the audit after the pending restart; drop items already fixed (⟳) | — | Audit table updated |
| P2 | Thread switch under 800 ms to first message at 4× / 100 ms: profile the long tasks, stop off-screen spinners, keep the composer mounted across switches, defer non-visible panels | thread-sidebar, chat, rich-composer, workbench | `phone-switch-probe` before/after in performance.md |
| P3 | First load under 3.5 s to usable composer: lazy sheets/panels, split the 2.4 s task | frame-layout, owners named by the profile | Load probe before/after |
| P4 | System back closes the top layer (CloseWatcher with a history fallback) for every sheet, drawer, popover and picker | plugin-ui, thread-sidebar, workbench | Journey: open each layer, back closes it, page stays |
| P5 | Drawer closes on any destination pick; Inbox and Land open their content directly | thread-sidebar | Journey at 390 px |
| P6 | Composer pickers as opaque phone sheets: Escape/back close, 48 px rows, files and threads before skills, keyboard-aware height | input-trigger, mentions | Screens + journey |
| P7 | Context meter and every popover kept on screen at 390 px (one shared phone placement rule) | rich-composer, plugin-ui | No popover outside the viewport in an automated sweep |
| P8 | Touch-target sweep to 48 px (Android guideline; current rule 44) with an automated audit over all surfaces | all UI plugins, docs rule | Sweep reports 0 targets < 48 px on primary actions |

### Tier 2: the agent loop on a phone

| # | Item | Owner | Acceptance |
|---|---|---|---|
| P9 | Approval and question cards inline in the transcript and Inbox, subagent requests surfaced in the parent, "reply = decline with feedback" | agent-questions, chat, thread-sidebar | Journey: approve from the parent thread |
| P10 | Send button shows Queue vs Steer while a turn runs; long-press for the other; queued messages editable / send now above the composer | rich-composer, queue-reorder | Journey |
| P11 | Per-message send state (pending / sent / failed + retry), auto-resend after reconnect, partial output kept with inline error | rich-composer, chat, session-controller | Offline journey |
| P12 | Thread list: needs-you threads jump to the top; "Draft:" marker; swipe to archive with undo; long-press multi-select; status filter tabs; titles get the width (machine/path on the second line, compact) | thread-sidebar | Screens + journeys |
| P13 | Transcript opens at newest (or first unread, setting); jump-to-latest with count; no blank gap while paging older rows | chat | Journey with a 180-turn thread |
| P14 | Inbox triage: swipe resolve with 5 s undo, Done view, snooze, tabs (Approvals / Questions / Failed), rendered Markdown previews; notifications grouped per thread and windowed | thread-sidebar, activity-timeline | Journey, DOM < 2k nodes |

### Tier 3: panels and review

| # | Item | Owner | Acceptance |
|---|---|---|---|
| P15 | Panel sheet: one header, opens the last view not a chooser, unmount views not shown, 44–48 px close | workbench, main-tabs, sidebar-right | DOM and timing before/after |
| P16 | Phone diffs: stacked only, wrap toggle, one file at a time with a file sheet, generated files collapsed, tap a line to quote it into the composer | diffs-review, jj-integration, rich-composer | Journey |
| P17 | JJ graph: placeholder rows while loading, swipe/long-press verbs, undo after land/rebase (`jj op undo`), destructive swipe only on unpushed revisions | jujutsu, jj-integration | Journey |
| P18 | Wide tables become cards or a horizontally scrolled region with sticky first column (Session log, Usage) | session-log-window, usage | No table wider than the screen without its own scroller |
| P19 | Context view: cut its 55 requests (batch / lazy sections) | rich-composer facets | Request count before/after |
| P20 | Terminal key row above the keyboard; logs follow tail with jump-to-latest and search | terminal owner, chat tool output | Journey |

### Tier 4: native capabilities

| # | Item | Owner | Acceptance |
|---|---|---|---|
| P21 | Push per category with Approve/Deny/Open actions, `launch_handler: navigate-existing`, deep link to the thread (see the push plan) | activity-timeline, thread-sidebar, pwa | Real-phone check |
| P22 | Share Target: share screenshots/text into a new or current thread | pwa, rich-composer | Real-phone check |
| P23 | Manifest shortcuts (New thread, Inbox); badging on iOS | pwa | Long-press icon on the phone |
| P24 | Voice dictation in the composer (Web Speech, fallback recorder + Host transcription), inserted at the cursor | rich-composer | Real-phone check |
| P25 | Keyboard: `interactive-widget=resizes-content` on Chrome to simplify visualViewport code; `overscroll-behavior: contain` on sheets, drawer, transcript | thread-sidebar phone-shell, plugin-ui | Keyboard journeys unchanged or better |
| P26 | Edge-to-edge: `viewport-fit=cover` audit, every fixed bottom bar padded by the safe-area inset | frame-layout, thread-sidebar | Screens with emulated insets |
| P27 | Wake Lock toggle while watching a run | rich-composer or agent-plan | Real-phone check |

### Tier 5: polish and hygiene

| # | Item | Owner |
|---|---|---|
| P28 | Hide desktop shortcut hints on touch (one helper in plugin-ui) | plugin-ui, consumers |
| P29 | Drop repeated page titles and description paragraphs on phone pages | settings-shell, page owners |
| P30 | Thread menu sheet: labeled actions, two levels max, consistent subagent counts | rich-composer, jj-integration |
| P31 | Composer status: no spinner on settled threads; the "Own workspace from main" spacing; the shortcut conflict | rich-composer, workspace-nav, main-tabs |
| P32 | Accessibility: focus trap + `inert` for drawer and sheets, focus return, reduced motion everywhere, large-text check | plugin-ui, thread-sidebar |
| P33 | Font: test the missing-text bug with a system font; if confirmed, ship static Geist weights | ui-styles |

## Decisions already made

1. 2026-11-16: drawer navigation is the owner's mode (`phoneNavigation: drawer`); stack stays the default for others.
2. 2026-11-17: drawer opens from a rightward drag anywhere on the stage, not only the edge (Android owns the edge).
   Discord's lesson (drawer vs system back) is respected by never using the edge alone; revisit with P4/P5.
3. Pushes cover every thread, with quiet hours ([push plan](../phone-push-notifications/README.md)).

## Open questions for the owner

1. Drawer plus bottom tabs, or drawer only? Discord found mixing both confusing and moved to one bottom bar.
2. Swipe actions on thread rows (archive left, pin/snooze right), or long-press menus only?
3. Touch targets: raise the repo rule from 44 px to Android's 48 dp?
4. Transcript landing: newest message, or first unread (Zulip makes it a setting)?
5. Voice input: browser speech recognition (Chrome sends audio to Google), or a Host-side transcription model?
6. Which tier first? Suggested order: P1 → P2/P3 (speed) → P4–P8 → Tier 2.
