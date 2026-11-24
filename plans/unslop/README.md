# Unslop: UI/UX audit and work list

Audit date: 2026-11-16, on the fork's `main` at `wqstyzvl`. This file is the audit and the work list that follows
from it. The fixes were built on upstream `astahmer/dshfiles` `main` at `b9ef35a3` and rebased on 2026-11-24 onto
`ecdb9212`, one revision per change, not on the fork's `main`, so they merge into upstream as a fast-forward. They
are the draft PR astahmer/dshfiles#271 (branch `contribute/unslop-ui` on the tbrowang fork); nothing is landed. Authority for every rule cited: [DESIGN.md](../../DESIGN.md) and the
[UX plan](../../docs/ade-ux/README.md).

**Resume here:** round one's 14 steps and round two's five lanes are done. Round two started 2026-11-24 after feedback that the monochrome changes
were dull: bring purposeful colour back and make daily use smoother, without undoing upstream's coloured project
chips (#287). See [Round two](#round-two). Round one's leftovers are under [Follow-ups](#follow-ups).

## Round two

- Rebased onto upstream `ecdb9212` (project chips with colours #287, Antigravity accounts). Upstream's coloured
  provider tiles in AI accounts were kept over round one's ink-only glyph, and its test now expects the brand colour.
- Upstream `main` itself failed `features:check` on three test names #287 renamed; fixed here.
- Upstream's chip text, provider tiles and project palette are counted in the ratchet baselines, not rewritten.
- Design direction, from a Fable 5.2 (high) consultation; the owner chose every recommended option. Colour has four
  jobs: attention (Needs you indigo, Failed red), results (Ready green dot, a green check for a verified land,
  all-pass tests, sign-in), identity (projects' own colour, provider brand marks, agents on `identity-1..8`, never a
  status hue) and data (`data-1..6`). Working stays an ink ring; controls turn indigo when on; project colour shows
  in the thread list by default. Smoothness: press feedback in 80 ms, tooltips after 400 ms, a newer toast replaces
  the showing one, a short tint on a row that changes state, one Land confirmation everywhere and Land on the phone.
  DESIGN.md carries the rules.

| Lane | Items | State |
| --- | --- | --- |
| Kit (plugin-ui, ui-styles, DESIGN.md, ratchets) | role tokens, glyph colours, control-on, HealthDot, press feedback, tooltip delay | done: 8 revisions `wnspznrr` … `vksqztzz` |
| Land (jj-integration, jujutsu, diffs-review, dialogs, test-runs, turn-summary) | phone Land, one confirmation, Landed in green, toasts, all-pass check | done: 7 revisions `qpmovqpy` … `qwpmrvxq`; the thread list's row verb still lands without asking (thread-sidebar); `/rebase` still takes about 55 s to show (needs a Host event) |
| Threads (thread-sidebar, main-tabs, workbench, command-palette) | project colour in the list, palette colours, chip contrast, state tint, tap feedback, Ready mappings | done: 7 revisions `tlkumozk` … `swppzxss`, plus `ytomktxu` (guide catalog). Stopped and blocked turns are Idle, not Ready. The palette reads project colours through a new `PaletteProjectColors` registry (importing workspace-folder-picker would close a cycle). Not done: Dockview tab press feedback; date-grouped views keep the older configurable dot |
| Land row verb (jj-integration, thread-sidebar) | the thread list's Land opens the confirmation; tooltip delays | done: `rslryxzr` (`ThreadHeaderLand.confirm`; without jj-integration the row opens the thread instead of landing), `rxkuzqno` |
| Pages (ai-accounts, model-effort-picker, usage, multi-host, mcp-servers) | Connected dot, brand marks, model chip mark, chart palette, host and MCP health | done: 9 revisions `ysszptlz` … `mtnwtuxu`. New labels: "Sign-in expired" in red; an MCP server needing sign-in is amber, not the Needs-you diamond. The Inbox draws green only for finished or landable work. Not seen rendered: a connected host, a failed MCP server, a multi-series Usage chart |

Also fixed while integrating: upstream's new project-names settings namespace had no Settings group (`tlksuovx`).
The kit lane found states that map to Ready without being finished work (a stopped or blocked turn, a waiting
restart notice); the threads and pages lanes remapped them.

Round two's open follow-ups: `/rebase` takes about 55 s to show in the header (needs a Host event from
jj-integration); two of upstream's project tones (rose) sit close to Failed red; Dockview tabs have no press
feedback; date-grouped thread views keep the older configurable dot; `ChartFrame` still maps `--ts-chart-*` onto
status hues; a passed connection-test step is still a muted check; `models-page-accounts.tsx` draws "Not signed
in" with a red dot. Not seen rendered: a connected host, a failed MCP server, a multi-series Usage chart.

## Method and limits

Six reviewers, each isolated from the others, then one synthesis.

| Id  | Pass                                    | How                                                                                           |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| A1  | Shell, conversation, composer (desktop) | Scratch DSH, 1440×900, light and dark, a 480 px split pane; 92 issues, 20 screenshots          |
| A2  | Plugin pages and Settings (desktop)     | Scratch DSH; all 62 Settings sections and 30 rail pages, light and dark; 53 issues             |
| A3  | Phone                                   | Playwright WebKit 26.0, iPhone 14 descriptor, 390×844; Chromium for trusted touch; 42 findings |
| B   | Static drift                            | Design detector plus grep and AST scans over 3,321 source files; the two repository ratchets   |
| C   | Copy                                    | 12,404 UI strings extracted from source; 151 quotes checked against file and line              |
| D   | Noise inventory                         | Slot, command, settings and notification registrations read from source                        |

Limits that apply to everything below:

1. Scratch instances start empty. Threads were seeded through the fake provider, and populated Land, Changes,
   Secrets and the Backlog board were judged from committed plugin screenshots.
2. No physical iPhone. Safe-area insets were 0 and the keyboard was simulated.
3. B, C and D count what the source registers, not what was seen on screen. Regex counts are estimates.
4. Contrast ratios, real performance and the live instance were not measured.
5. Not seen at all: zen mode, attachments, executed undo and redo, workbench docking, the Backlog board on a phone,
   toasts on a phone, thread-row swipe, drag to reorder.
6. The synthesis opened 8 of the 60 screenshots and re-checked 5 source claims. Findings marked ✔ were confirmed
   that way; the rest are as reported by the pass named in the Evidence column.

The six reports and 60 screenshots are in `.cache/unslop-audit/` of the thread workspace that ran the audit. That
folder is not tracked: the reports quote this machine's user and host names. Decide whether to commit a scrubbed copy
(open item O1).

## Scores

Usability heuristics, 0–4 each. The "All" column is the rounded mean of the three visual passes.

| #   | Heuristic                   | A1     | A2     | A3     | All    |
| --- | --------------------------- | ------ | ------ | ------ | ------ |
| 1   | Visibility of system status | 2      | 3      | 2      | 2      |
| 2   | Match with the real world   | 2      | 2      | 2      | 2      |
| 3   | User control and freedom    | 3      | 3      | 3      | 3      |
| 4   | Consistency and standards   | 1      | 2      | 2      | 2      |
| 5   | Error prevention            | 2      | 3      | 3      | 3      |
| 6   | Recognition over recall     | 2      | 2      | 2      | 2      |
| 7   | Flexibility and efficiency  | 3      | 3      | 2      | 3      |
| 8   | Minimalist design           | 2      | 2      | 2      | 2      |
| 9   | Error recovery              | 2      | 3      | 2      | 2      |
| 10  | Help and documentation      | 2      | 3      | 2      | 2      |
|     | **Total**                   | **21** | **26** | **22** | **23** |

23/40 is the "acceptable" band: a solid base with significant work left. Cognitive load is high in all three passes
(4, 5 and 5 of 8 checklist items fail).

## Verdict

The thread list is the product DESIGN.md describes: status groups, six glyphs, no colour except an indigo diamond and
one black "Answer". Almost everything else is tidy plugin by plugin and incoherent as a whole. The tell is not
ugliness. Each plugin answered "where do I show my fact?" with "everywhere I have a slot", and nothing removes the
copies. The three moments that define supervising agents (answer a question, recover a failed turn, land finished
work) are the weakest parts of the interface.

## Root causes

1. **No owner for a fact.** Status, counts, plan, job, restart and toasts are each drawn by several plugins.
2. **Fixed surfaces have a budget in prose only.** Nothing fails when a plugin adds a header control or a dock.
3. **Engineering text reaches the screen.** Catalog summaries, package descriptions, config keys, error objects and
   tool output are shown as written for developers.
4. **The page template is optional.** 20 of 46 page-type plugins use `Page`; the largest UI plugin does not.
5. **The guardrails are not running.** Both design ratchets fail on `main`, and neither is in `check:green` or CI.

## Findings

Severity: P0 blocks a task, P1 significant difficulty or a clearly broken look, P2 annoyance. ✔ = confirmed during
synthesis. Paths are under `plugins/@dshfiles/`.

### W1. Things that are broken

| Id  | Sev | Finding                                                                                                                                                              | Owner                              | Evidence          |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------- |
| U1  | P0* | At phone width in WebKit the composer's `@`, `/` and `+` lists are laid out and tappable but not painted. Removing the narrow-only `.card { overflow-x: clip }` made them paint. *Measured in a macOS WebKit build; confirm on the iPhone. | rich-composer `src/native/skeleton/InputBar.module.css:882` ✔ rule exists | A3 #1 ✔ shot 01 |
| U2  | P1  | Once painted, those lists are see-through on desktop and phone: transcript text reads through the rows. The `+` menu first shows only a "Commands" heading.            | rich-composer, input-trigger       | A1 C2, C3; A3 #2  |
| U3  | P1  | Tool timing text ("0.1 s · 15:16") is drawn on top of the HTML card's header icons and runs into the test card's own duration.                                       | tool-meta                          | A1 T2 ✔ shot 06   |
| U4  | P1  | The model picker opens as two detached panels and the right one runs off the window edge.                                                                            | model-effort-picker                | A1 C1             |
| U5  | P1  | A restored right-pane tab shows `"dshfiles-resource/session-…/tab2" is not available`, under two tabs both named "Changes".                                          | workbench, sidebar-right           | A1 L1; A2 #51     |
| U6  | P1  | Backlog's pinned composer overlaps the item detail pane and hides its last section. The detail title is the raw id `b:w33f`.                                         | backlog                            | A2 #14, #16       |
| U7  | P1  | Phone body text renders at 13/12 px although the density tokens resolve to 15/13 px. Strings at 10–11 px remain.                                                     | plugin-ui, ui-styles, chat         | A3 §3.2, §3.3     |
| U8  | P1  | A phone in landscape (844×390) gets the desktop rail, tab strip and status strip.                                                                                    | thread-sidebar, frame-layout       | A3 #26            |
| U9  | P2  | Rows and chips are cut with no scroll hint at 480 px on Hosts, Traces, Processes and Backlog.                                                                        | multi-host, traces, background-jobs, backlog | A2 #53  |

### W2. The supervising moments

| Id  | Sev | Finding                                                                                                                                                                 | Owner                                   | Evidence                   |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------- |
| M1  | P1  | The Inbox says "Answer in place" but a question item prints raw Markdown and HTML, offers three canned replies unrelated to the question, then says to open the thread. | activity-timeline, agent-questions      | A1 I1, I3; A3 #11, #12 ✔ shot 04 |
| M2  | P1  | "Answer" on a subagent's question opens the parent thread, which shows no question.                                                                                     | agent-questions, thread-sidebar         | A1 I2                      |
| M3  | P1  | On a phone the question card's options sit below the fold of a scroller nested in the transcript, while Skip and Submit stay visible.                                   | user-questions                          | A3 #8                      |
| M4  | P1  | The failure card prints `400: {"message":…}` and an all-caps code, with two Retry buttons from two plugins, for an error that will repeat.                              | chat, agent-plan                        | A1 T8; A3 #15 ✔ shot 08    |
| M5  | P1  | A thread whose last turn failed is filed under Idle with a faint ring.                                                                                                  | thread-sidebar                          | A1 S4; A3 #16 ✔ shot 08    |
| M6  | P1  | Land is an outline button inside a popover behind a chip that reads "1". The thread with work to land sits in Idle.                                                     | jj-integration, thread-sidebar          | A1 H4, S5                  |
| M7  | P1  | The header shows "+21 −0" on threads that changed no file. A1 reads it as the shared checkout's diff; the cause is not confirmed.                                       | jujutsu or diffs-review                 | A1 H3 ✔ shots 06, 08       |
| M8  | P2  | Triage mode shows 11 actions for one item, three of them twice.                                                                                                         | activity-timeline                       | A3 #13                     |

### W3. One fact, many copies

| Id  | Sev | Finding                                                                                                                                                                              | Owner                                        | Evidence                    |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------- |
| N1  | P1  | "Needs you" is an indigo diamond in the list, an amber dot on the tab, a grey spinner in the header and "Idle" in palette results. The tab strips colour working blue and Needs you amber, the reverse of the vocabulary. | main-tabs `src/tab-strip.tsx:51` ✔, workbench | A1 L2, H8, P2; B 3f; D §7 |
| N2  | P1  | Working counts disagree on one screen: "Working (1)", "2 working", "Working • 3".                                                                                                    | thread-sidebar                               | A1 S3 ✔ shot 08             |
| N3  | P1  | The thread header has 6–7 always-on controls against a budget of 3, including two `⋯` of different weight. Copy link and Pin are also rows of the `⋯` beside them. The title is cut at about 200 px beside empty space. | thread-sidebar `src/header-actions.tsx:280` ✔, jujutsu, native | A1 H1, H2; D §1.2 ✔ shots 06, 08 |
| N4  | P1  | Hovering a thread row draws six unlabeled icons over its title. Needs-you rows are cut to 8–13 characters.                                                                           | thread-sidebar                               | A1 S1, S2 ✔ shot 08         |
| N5  | P1  | Three "Context injection · runtime-context" rows lead every turn and are the only content of a working thread.                                                                       | chat                                         | A1 T1                       |
| N6  | P2  | Within one turn the plan is shown three times, a running job three times, and the summary line is restated by the walkthrough.                                                       | agent-plan, chat, background-jobs, turn-summary | A1 T5–T7, T11 ✔ shot 06  |
| N7  | P2  | One running thread lights six working indicators. `StatusGlyph` is imported by 10 of 105 loaded plugins; `StatusDot` has 39 uses and at least seven private tone tables.             | many                                         | D §6, §7; B 3f              |
| N8  | P2  | Restart appears on 7 surfaces; there are 9 toast implementations; the status strip holds 3 items each from thread-sidebar and ai-accounts.                                           | thread-sidebar, hmr-gate, dialogs, ai-accounts | D §5 i, §6; A1 L7         |
| N9  | P2  | About 70 destinations. Component gallery, Plugin guide and Traces' developer tabs sit in the user rail; Capabilities hub is a page of three links; Plugin Market prints an install command. | component-gallery, plugin-guide, capabilities-hub, traces | D §2; A2 #45, #47, #48 |
| N10 | P2  | The same workspace state is drawn in 13 places by 5 plugins; Land has 4 pages where 2 would do.                                                                                      | jujutsu, jj-integration, diffs-review        | D §5 b                      |
| N11 | P2  | About 123 declared commands with two id grammars, five label styles and duplicates (Toggle sidebar ×3, New thread ×4). The empty palette leads with six monitoring pages and no thread. | thread-sidebar, command-palette           | D §3; A1 P1                 |
| N12 | P2  | On a phone: four `⋯` on the thread screen, a docking tab strip inside the thread panel sheet, a two-level thread menu, and keyboard hints ("⌘ ⌥ /", "Space to close").               | workbench, thread-sidebar, plugin-ui         | A3 #4, #17–#19, #31         |

### W4. Words

| Id  | Sev | Finding                                                                                                                                                                  | Owner                          | Evidence        |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | --------------- |
| C1  | P1  | 505 of 565 catalog feature summaries exceed 140 characters (median 362). Getting started and What's new show them.                                                       | every `dshx.features.json`     | C §1            |
| C2  | P1  | 386 of 738 error-like strings carry no recovery word and 23 end in a raw `{message}`. 114 client strings use "Host" for the server process, against the glossary's "host". | many                           | C §3, §6        |
| C3  | P1  | 152 agent-tool bindings use `render: compactJson`, so their transcript row is `JSON.stringify(output)`.                                                                  | multi-host and others ✔ grep   | C §3            |
| C4  | P2  | 74 status words outside the six states appear 246 times (Running 24, Completed 7, In progress 5).                                                                        | jj-integration, thread-sidebar, rich-composer | C §7 |
| C5  | P2  | Eight words mean "get this out of my way": Park, Settle, Archive, Mute, Done, Snooze, Dismiss, Mark read. The glossary keeps Done, Restore and Snooze.                   | thread-sidebar, activity-timeline | A1 S10; C §4 |
| C6  | P2  | Native forks still say session, conversation and task (216, 71 and 135 strings in UI copy).                                                                              | workspace-nav, schedule, rich-composer, chat | C §4 |
| C7  | P2  | Nine duration formats on screen ("7m", "7m 51s", "17 min 56 s", "0.0 s · 15:14", …) and four date formats.                                                               | many                           | A1 §5; A2 §6    |
| C8  | P2  | Of 24 destructive confirmations, 11 name the thing and 11 give a way back. One uses the browser's `confirm()`.                                                           | backlog and others             | C §9            |

### W5. Pages and Settings

| Id  | Sev | Finding                                                                                                                                                                 | Owner                              | Evidence               |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------- |
| P1  | P1  | Settings is 62 sections in 11 groups; General holds 15 and "Other" 12, including Projects. Every plugin row prints its config key and source.                           | settings-shell                     | A2 #1, #2 ✔ shot       |
| P2  | P1  | Settings sections fall back to package descriptions ("The dsh browser-surface bundle…"), show byte counts as values (`67108864`), raw enum values and a "Demo panels" switch. "Allowed models" is a raw JSON textarea. | settings-shell and schema owners | A2 #3–#5 ✔ shot |
| P3  | P1  | Two renderers in one Settings scroll: content width jumps from 880 to 760 px and three segmented-control styles appear.                                                 | settings-shell, thread-sidebar     | A2 #6                  |
| P4  | P1  | AI accounts: blue switches (ink elsewhere), a green dot per account, a green "Connected" badge, a 3 px indigo side border, a 64 px teal icon tile, cards inside cards. The same accounts are also a 9,705 px form in Settings. | ai-accounts | A2 #19–#21 ✔ shot |
| P5  | P1  | Backlog has its own chrome: a 14 px title in a toolbar, seven icon tabs, six unlabeled icon buttons. On a phone the toolbar is 13 or more unlabeled icons with the search cut off. | backlog                  | A2 #13, #18; A3 #36    |
| P6  | P1  | Dashboards of zeros: Memory › Analytics (ten icon stat tiles), Usage › Cost (eleven `$0.00` blocks under 18 filter options), Processes (14 category chips at 0).        | memory, usage, background-jobs     | A2 #22, #25, #34       |
| P7  | P1  | Traces reads as a separate product: a green "Receiving on http://127.0.0.1:…" chip, an ALL-CAPS stat strip with truncated labels, chip soup in Alerts.                  | traces                             | A2 #27, #28            |
| P8  | P1  | History and Source control have no page header and share one empty text that names the wrong page. Native Schedules and Plugins use a centred column, an illustration and coloured icon tiles. | jujutsu, native rows | A2 #36, #46     |
| P9  | P2  | Six pages have a nav name that differs from the heading (Workspaces opens "Land", Capabilities opens "Agent toolkit"). On a phone the page title prints two to four times. | several; plugin-ui `Page`       | A2 §6; A3 #25          |
| P10 | P2  | Empty states come in five shapes on screen and eight in source; 82 of 115 literal empty texts are hand-rolled.                                                          | several                            | A2 #50; B §4           |
| P11 | P2  | Hosts: one row holds 13 controls, and a switched-off "Link this machine" form sits above the list.                                                                      | multi-host                         | A2 #30, #31            |
| P12 | P2  | `Page` is used by 20 of 46 page-type plugins. Seven destination pages render none: agentsview, backlog, jujutsu, project-automations, resource-packs, schedule, whiteboard. | those plugins                   | B 3i                   |

### W6. Guardrails

| Id  | Finding                                                                                                                                                                            | Evidence            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| G1  | `check:design-tokens` (192 findings against a baseline of 178) and `check:copy` (82 against 80) both exit 1 on `main`. Neither is in `check:green` or the CI workflow.             | B §2 ✔ re-run       |
| G2  | `copy-check` skips `native/` directories, settings schemas and catalog text: 4,684 of 12,404 strings are outside it. `design-token-check` skips four forks holding 94 more findings. | C §4; B §2        |
| G3  | The kit ships defaults DESIGN.md forbids: plugin-ui holds 57 of 98 off-scale shadows, 36 of 45 numeric durations and 20 of 78 viewport variants. Its motion components hold most of them. | B patterns 1, 2 |
| G4  | 27 vendored native forks (81 CSS files, 15,840 lines) are outside most checks.                                                                                                      | B pattern 3         |
| G5  | 40 of 58 spin and pulse sites have no reduced-motion variant; 6 of 10 opened `outline-none` sites have no focus replacement.                                                        | B 3h, 3l            |
| G6  | The scratch-verification catalog has drifted: 7 walks failed in A1, 50 of 121 in A2 (stale "Account menu" and "New session" steps), and every seed step fails at `--narrow`.        | A1 §8; A2 §9; A3 §8 |
| G7  | Building regenerated `onboarding/src/generated/feature-catalog.ts` and `plugin-guide/src/generated/guide-catalog.ts`, so the committed copies are stale (`hmr-gate#update-timing` is missing). | seen during setup ✔ |
| G8  | DESIGN.md says "~80 plugins" (105 load by default) and contradicts itself on the working state (shimmer in Motion, ring spinner in Components).                                    | D scope; B 3h       |
| G9  | The design detector fired 4 of its 62 rules (168 findings, mostly false positives or fork CSS). Whether the other 58 can match `dshx:`-prefixed classes is unknown.                 | B §1                |

## What already works, and should not change

1. The thread list: status groups, six glyphs, one inline "Answer". Every other surface should be held to it.
2. The in-thread question card on desktop: replaces the composer, numbers its options, marks one "Recommended".
3. Notifications is the model page for `Page` → list → row.
4. Run-picker copy ("Your checkout stays untouched until you land the work.") and the mode menu.
5. Dark matches light on every page checked, with no dark-only defect.
6. Source hygiene where it is checked: 4 named-palette classes in 36,914 utilities, 98.8 % of type sizes on the
   ramp, 629 container variants against 78 viewport ones, 0 unlabelled icon-only buttons among 303, no input under
   16 px and no horizontal overflow at 390 px.
7. Settings mechanics: search, Modified filter, per-setting reset, and a nav that becomes one select when narrow.
8. Short labels: no exclamation marks, no marketing adjectives, one plugin-prefixed label left.

## Work list

Ordered by visible improvement per unit of effort. A step is done when its revisions exist with a check that failed
before and passes after; see each revision's description for the reason.

| Step | Work                                                                                                                                                  | Findings          | Size   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| 1 ✅ | Composer menus: the card no longer clips (WebKit paints the lists again) and native menus are opaque. Probed in Playwright WebKit 26.0 and Chromium at 390 px before and after; not yet re-checked on the iPhone. | U1, U2 | small |
| 2 ✅ | Deletions on the main surface: "Context injection" rows hidden, no timing overlay on card headers, one header `⋯` holding Copy link, Pin and the native More actions, one verb plus `⋯` on row hover. | U3, N3, N4, N5 | small |
| 3 ✅ | Tab strips draw the shared status glyph; one projection for working counts; failed stays Failed. See [Thread lane](#thread-lane) and [Tabs lane](#tabs-lane). N7 is only partly closed: the plugin pages that draw their own status dots are steps 8 and 12. | N1, N2, M5, N7 | medium |
| 4 ✅ | Failure card: one sentence, one Retry, "Ask to fix" in the same row, code and payload under Details. No "Compact and retry": the over-long sentence names `/compact`. | M4 | medium |
| 5 ✅ | Inbox question items show the question's own options and answer in place, open forms included; a subagent's question is answerable in its parent thread; the phone question card keeps its options in view; triage has one action row. See [Inbox lane](#inbox-lane). | M1, M2, M3, M8 | medium |
| 6 ✅ | A primary "Land" in the header when there is work to land, behind one confirmation; the "+N −N" chip shows only for a thread's own workspace. See [Land lane](#land-lane). | M6, M7 | medium |
| 7 ✅ | Settings rows: key and source lines hidden, no package-description fallback, units and enums humanised, nav regrouped with no "Other". See [Settings lane](#settings-lane). | P1, P2, P3 | medium |
| 8 ✅ | No zero-count chips, tiles and stat blocks on Usage, Memory and Processes. See [Pages lane](#pages-lane). | P6 | small |
| 9 ✅ | AI accounts on the kit switch and the colour rule, one header row, no nested cards. See [Pages lane](#pages-lane). | P4 | small |
| 10 ✅ | Developer pages in a "Developer" group at the end of Settings (setting to hide it, shown by default); Capabilities hub quiet and no longer first; Plugin Market says what to do. See [Destinations lane](#destinations-lane). | N9 | small |
| 11 ✅ | Copy: catalog summaries one sentence, errors with a next step, six status words, glossary, short settings descriptions, Retry. C3 dropped. See [Catalog copy lane](#catalog-copy-lane) and [UI copy lane](#ui-copy-lane). | C1–C8 | large |
| 12 ✅ | Backlog and Traces on the kit `Page` (History and Source control were done in the Land lane). See [Backlog lane](#backlog-lane). | P5, P7, P8, P12 | large |
| 13 ✅ | Phone: kit text follows the density tokens (15/13 px), a sideways phone keeps the phone shell, full-screen palette, no keyboard hints on touch, page titles printed once. See [Phone lane](#phone-lane). | U7, U8, N12 | large |
| 14 ✅ | Guardrails: both ratchets in `check:green` and CI, `copy-check` widened, new rules for shadows, durations, viewport variants, solid status fills and more. G6 (catalog walks) dropped. See [Guardrails lane](#guardrails-lane). | G1–G7 | medium |

## Transcript lane

18 revisions (`oprnuozzrsyo` … `psutzysxqxps`) in chat, tool-meta, agent-plan, turn-summary and test-runs, each with a
test that failed before and passes after. Beyond U3, N5 and M4 they cover N6 (plan and summary shown once), one work
fold instead of two, zero durations and repeated clock times removed, the test card's colour and zero-count filters,
and 44 px targets on the summary row.

Deliberate differences from the audit's proposals:

- Context rows show in the existing Verbose view mode; no new "3 context items" row.
- The To-dos strip is off by default behind a new `todoStrip` setting (agent-plan).
- The walkthrough is offered only when it says more than the file chips; the three-line rewrite was not done.
- "Since you left" is hidden for a single unseen turn.

Follow-ups, closed in three more revisions (`yospzvntmxrq`, `pvkyoyovrmzw`, `wqkpnmmsqkxo`):

- Journeys on the final tip, forced: chat 11 of 11, tool-meta 5 of 5, agent-plan 5 of 5, turn-summary 2 of 2.
- `test-runs.card` and two background-jobs scenarios (`board-browser-journey`, `transcript-job-preview`) fail at the
  base revision too; the last one passes with this lane's step fix.
- The summary line spends one red part on a failure ("2 of 8 tests failed ›") and puts no separator after a chevron.
- tool-meta's screenshot and catalog text describe the new timing format.
- Dark theme looked at for the failure card, work fold, test card and summary line: nothing to fix.

Not looked at: WebKit.

Outside the lane, not started: the job strip titled by its shell command (background-jobs), the duplicate "Ask
question" row (tool-ask-user, user-questions), the green check on `ToolCard` (plugin-ui), the stalled-stream advice
verb and route id (ai-accounts), the "Edited N files" card with a coloured tile (deliverables).

Host-side settings text changed in chat, tool-meta, agent-plan and turn-summary, so a running instance shows those
only after a restart.

## Thread lane

20 revisions (`ulsmquzryowl` … `kxsumpqpzxmu`) in thread-sidebar, plus two in rich-composer for the header. Each has a
test that failed before and passes after.

- A failed thread stays Failed (red cross, "Turn failed") in the Needs you group after it is read.
- The group header, the status-strip item and the filter preset read one working count.
- Row hover keeps the title and shows one verb plus `⋯`; needs-you rows give the title the first line.
- The header has one `⋯`. Copy link and Pin are rows of it, and so are the native More actions: rich-composer reads
  them through the Host's context-menu service, so no core patch was needed. Without thread-sidebar the native button
  stays.
- The title flexes to the status chip; a thread waiting on a question shows the Needs you glyph in the header.
- Update and Restart are one status-strip item with a next step; Restart is off the rail by default behind a new
  "Show Restart DSH on the rail" setting.

Deliberate differences: Failed has no inline Retry on the row; the default hover verb is still labelled "Settle"; a
user who saved a choice of hover actions keeps it; a header narrower than 36rem keeps the old title cap.

Not done:

- A thread with a running background job is not Working: thread-sidebar has no per-thread job signal
  (background-jobs would have to expose one).
- The unsent draft is renamed "New thread" but still counted under Idle (a journey asserts it is listed).
- A pending approval still shows the working spinner in the header.
- The row menu still has 18 entries and says Settle, Park and Archive. Proposed, not built: Done, Restore and Snooze
  in labels only, and about 8 entries grouped under Open in, Copy and More.
- The indigo dots on filter presets follow the user's attention-colour setting and were left.

Unverified:

- `pnpm check:e2e thread-sidebar`: 43 passed, 18 failed. 14 of the 18 fail at the base too; the other 4 pass after
  step fixes, one of them (`remote-row-verbs`) only on a third try. No full run after the last fixes.
- `row-verb-clear-of-hover-actions` has not passed; the 1 px clearance was measured by hand in a scratch instance.
- Phone and touch layout of the changed row; the subagent row title and the Ready state were never seen rendered.

The Host half of thread-sidebar changed (failed turns, live-turn flag), so a running instance shows the failed and
Needs you fixes only after a restart. Onboarding still says "Restart DSH (bottom of the sidebar)".

## Inbox lane

14 revisions (`wuzxwztzlrot` … `wvmqltyknsky`) in activity-timeline, agent-questions and user-questions.

- An Inbox item that asks a question shows that question's options as its buttons and no canned replies; the body is
  two plain lines instead of Markdown and HTML source.
- A form that is still open (including a blocking one) can now be answered from the Inbox. agent-questions became one
  more answerer on the `user-questions/request` waterfall: it holds each open request, races its own answer against
  the browser's, and retracts the browser's form through the request's cancellation signal. The agent tool
  `answer_thread_question` gained the same reach (root-only, "run only when the user asked"). The native `answer`
  still takes continued forms only; `plans/dsh-host-gaps.md` row 16 says what is wanted from the Host.
- A subagent's pending question shows above the composer of its parent thread with its options.
- The question card keeps its options above Skip and Submit at every width, hides the pager for one question, and
  words its second exit "Answer later".
- Triage shows one action row. The Inbox fills its pane; its two alert switches moved behind the page `⋯`.
- Activity rows show thread titles instead of `session-…` ids, one status tint, sentence case.

The Inbox still cannot answer: forms with several questions, multi-select or free text only, more than 8 options,
forms of a stopped or subagent thread, and an open form asked before the Host loaded the plugin. Those keep "Open
thread" as the one action and say why.

Not done: the duplicate "Ask question · waiting · Answer" row above an open card is drawn by core
`@deepseek-ai/dsh-client-ui-tool`, which has no fork here.

Unverified:

- Journeys: activity-timeline 3 of 3. agent-questions 0 of 11 and the markdown-question journey 0 of 1, at the tip
  and at the base alike (four stop at the new-thread composer, seven abort on "Use Node 22.23.3 for DSH acceptance",
  one never finishes start-up), so the assertions this lane added to them have never run.
- The open-form answerer is covered by unit tests and one reach walk; a timed form answered inside its countdown and
  a browser disconnecting while a form is held were not exercised.
- Phone checks used Playwright WebKit with an iPhone 14 descriptor, not a device.

agent-questions and activity-timeline changed their Host halves, so a running instance needs a restart.

For thread-sidebar, not started: "What needs you, answered in place" and the "Needs you" page label, merging Waiting
threads into the Inbox, the count badge drawn over the Needs you icon, and the subagent card's "Working · In
ask_parent_question" with a raw route id.

## Land lane

23 revisions (`rxmpwnolspxz` … `umwxvmmpwynr`) in jj-integration, jujutsu and diffs-review, plus a repair of the
`rebase-ready-thread` scratch seed in dshx.

- The "+N −N" chip was `jj diff --stat` from the fork point of main to `@` for the thread's folder, so a thread in
  the project checkout showed the whole checkout's diff. It now shows only for a thread in its own workspace with
  changes. A project thread has no chip; its workspace menu says "The project has changes that are not on main" with
  a Review button.
- The header carries a primary "Land" while there is work to land and landing can start (no conflict, every revision
  described, no busy thread, nothing queued). It and the menu's "Land on main" open one dialog listing the
  revisions. Before, the menu's button landed on click with no confirmation.
- The chip reads "Own workspace · N to land"; the menu shows the end of the workspace path with the full path in a
  tooltip and a copy button.
- History and Source control have a page header, a repository select that defaults to the current project, one
  toolbar row with a Filter menu, and their own empty text.
- The Workspaces page has one name and the shared status glyphs, with zero-count filters hidden. The land card says
  what holds in one muted line and shows a chip only for a failing check. The Changes scopes use the kit segmented
  control.

Not done:

- "Download thread log" is still in the workspace menu as well as the thread `⋯`: jj-integration cannot tell
  whether the thread menu hosts the native entry.
- At 390 px the phone top bar has no seat for the workspace control, so there is no header "Land" on a phone; landing
  there goes through the turn-end offer or the land card.
- Host activity strings still say "revision(s)" and "rebased"; the thread panel's view is still titled "Jujutsu".
- The meter line of a project thread still says "N ahead of main".

Seen and left: two black "Land" buttons when the Changes view is open (header and land card); the thread list's
inline Land runs without the confirmation; the "N to land" tag can stay stale up to 60 s after `/rebase`; a New
thread send can land in another prepared workspace than the composer named.

Proposed, not built: keep Changes as the thread's one workspace view, drop Thread workspaces from "Choose a view",
rename the panel's Jujutsu to History, remove the Land › Review redirect and fold Source control into Changes.

Unverified:

- Journeys, first pass: diffs-review 7 of 9, jujutsu 16 of 17, jj-integration 20 of 28. Six failures were caused by
  the lane and pass after step fixes. Five fail at the base too (`git-thread-scopes`, `ambiguous-destination`,
  `new-thread-preparation`, `project-switch-with-saved-draft`, `thread-workspace-menu`). No full pass after the
  last fixes; the edited multi-host and thread-sidebar steps were not run.
- The row verb "Land" in the thread list was not seen rendered. WebKit and a remote thread's header Land were not
  checked.

jj-integration's Host half changed (`/rebase` wording), so a running instance needs a restart.

## Guardrails lane

27 revisions (`ktusqnvlsxyo` … `ysuqqxmoznzz`) in scripts, CI, plugin-ui and the docs.

- `check:design-tokens` (541 findings) and `check:copy` (138) run in `check:green` and in CI's `repo` job, and exit 0.
  The copy baseline is keyed by term and plugin. 13 design-token keys were raised to their current counts, because
  the check was already over its baseline (194 against 178) before this work; two of those are new since the audit
  (`text-[15px]` in thread-sidebar's phone shell, one radius in a chat native CSS file).
- New design-token rules, each with a unit test: default shadow steps (92), numeric durations (47), viewport variants
  in plugin code (46; dialog `max-w-*` allowed), solid status fills outside the kit (32), numbered palette colours
  (2), `uppercase` (20), spin or pulse without a reduced-motion variant (10), `outline-none` on a control with no
  focus style (4). The four forks it used to skip are now counted (96).
- `copy-check` now reads native directories (30 new), settings descriptions (1), catalog text (15), `locale/en.json`
  (1), label tables in plain `.ts` (5) and template-literal prefixes (11). New rules: "Host" as the server process
  (9), package names (2), messages ending in a raw error (13), non-canonical status words (21), "Try again" (0),
  "..." (0). Non-English tables are skipped.
- The kit maps Tailwind's `shadow-xs..2xl` onto the elevation levels, so 92 default shadows draw the design's
  elevation. Compared on the component gallery; an open popover or dialog was not screenshotted.
- DESIGN.md: 105 plugins; the working glyph is a turning ring and the 2.2 s shimmer is only the activity line; phone
  text sizes and the sideways-phone shell. `docs/repository-checks.md` lists every ratchet rule.

Dropped: G6. A static check finds every reach label in source, because the native forks carry core labels; the stale
steps are stale because the default composition hides those rows, which only a browser walk shows.

`check:green` parts that fail identically at the base: `test:scripts` (one `profile-sync` test), `check:effect-native`
(two multi-host mocks), `knip` (two unused files). Not run: `check:dshx`, full `check:plugins`, `check:plugin-boot`,
`check:e2e:smoke`.

## UI copy lane

15 revisions (`mpnzysmnrzzs` … `oxlvynrm`) across about 65 plugins' locale tables and UI strings, plus `knxtpzlm`
(regenerated onboarding catalog). Counts from a scanner built on `copy-check`'s extractor, English only:

| Pattern | Before → after |
| --- | --- |
| "Host" for the DSH process, package names, "bundle" | 146 → 7 |
| Errors with no next step / ending in a bare `{message}` | 363 → 264 / 19 → 8 |
| Status words outside the six states | 119 → 84 |
| session / conversation / chat / settle / integrate | 132 → 71 / 27 → 14 / 22 → 14 / 11 → 5 / 3 → 1 |
| Settings descriptions over 140 characters / semicolon chains | 75 → 0 / 200 → 47 |
| "Try again" labels / "..." / Title Case | 38 → 0 / 1 → 0 / 85 → 74 |

107 of the 264 remaining errors sit next to a Retry or Refresh control. `check:copy` passes (30 findings, all within
its baseline); it failed before.

Left as is: strings in native-fork files the fork does not already declare as changed (schedule's 80 "task" strings,
"Close Tabs to the Right", the 21 raw plugin titles in `locale/en.json`); labels journeys navigate by ("New session",
"Queue Reorder", "Thread Sidebar"). Translations of changed keys were not reviewed by a native speaker.

Unverified: jj-integration and thread-sidebar journeys and one workbench scenario were not run; secret-catalog and
background-jobs failures were compared with earlier lanes' base runs, not a fresh one. Settings descriptions and Host
strings changed in about 25 plugins, so a running instance needs a restart.

## Catalog copy lane

17 revisions (`ytpxqtpxyyrw` … `polqynupuomt`) across every `dshx.features.json` and tooling/dshx.

- All 568 feature summaries are one plain sentence: over 160 characters 496 → 0, with a semicolon 317 → 0, with a
  backtick 49 → 0, saying "Host" 128 → 0, "Session" 44 → 0. About 90 titles lost plugin names and old glossary words.
- Each old summary is kept verbatim in a new optional `details` field that nothing renders.
- `features:check` fails a summary over 160 characters, with a semicolon or with a backtick, and points to `details`.
- The derived catalogs, pack docs and migration map are regenerated (they were already stale on the base).

Users see `summary` in Getting started, its search, the Try it prompt and the onboarding agent tools. What's new does
not read the catalog; it comes from the jj history.

C3 dropped: a dshx tool's `render` is the tool result the model receives (`tooling/dshx/packages/dshx/src/api/host-
runtime.ts:252`, `dsh-tools` `pipeline.js:202`), so a sentence render would hide the data from the agent. The
transcript's collapsed row is `toolName · <first string argument>`, never the render; a call with no string argument
shows its raw argument JSON (`traces_reclaim_space · {"confirm":true}`). Follow-up: a dshx `tool.label(output)` kept
in `presentationMeta`, which the model never sees, shown by chat's tool row.

Not done: package descriptions that Getting started also shows still read as engineering notes (input-trigger's
"Codex-style @ token targeting"). Getting started was not looked at in a scratch DSH.

## Backlog lane

13 revisions (`wtzswwqo` … `srttppkw`) in backlog and traces, plus `ttnsyuvs`, which fixes the dshx spec for the traces seed
(the lane changed `scratch/seed.ts` to follow the removed receiver chip but not its dshx spec).

- Backlog is on the kit `Page`: `h1` with a count, one-line description, primary New, seven labelled views (one select
  below `@max-pane-narrow`), one "View" popover for scope, sort, hide-agent and saved views, Settings and backfill in
  the page `⋯`. The capture box shows on Feed only (New opens it elsewhere) and keeps one hint. The detail is titled
  by the item's name with its id as trailing meta. Status filters are a kit toggle group without zero counts. Reply
  deletion uses the kit dialog; looping spinners stop under reduced motion; focus rings are back on hand-built
  triggers.
- Traces: no green receiver chip or service tiles; Traces · Logs · Alerts tabs with the other five under "More";
  alert states as glyphs; no firing toast while Alerts is on screen; resolved alerts silent by default (new
  `announceResolved` setting); receiver, retention and stall settings fold under Advanced; plain copy in the
  empty state and confirmations.

Kept or deviated: the seven Backlog views stay views (Inbox, Ready and Shipped have their own layouts and stored
`view` values), drawn as a navigation row in the kit segmented style rather than `Page` tabs, because `Page` tabs
cannot act as links with a current-view marker.

Not done: the trace stat strip's ALL-CAPS truncated labels come from the kit's `motion/cost-waterfall.tsx`; Backlog's
group headers still colour Done green and In progress amber; the Alerts intro still says "on the Host"; the item
detail clips its pickers row at 390 px; durations still read "120ms" where journeys expect "120 ms".

Unverified: journeys backlog 62 / 20 and traces 6 / 5 on the first forced pass; every remaining failure fails at the
base at the same step (mostly the harness's "Add a project" dialog). No full suite after the last fixes; phone views
checked in Chromium at 390 px, not WebKit. traces needs a Host restart (settings schema and client inject list).

## Phone lane

16 revisions (`kywtrloqyoup` … `oqqzukqypllq`) in plugin-ui, input-trigger, deliverables, frame-layout,
command-palette, and the phone parts of thread-sidebar and rich-composer. All client code.

- Text: `.dshx-root` and `--text-xs|sm|base` were fixed rem values and nothing read the density tokens. They now
  read `--dshx-density-text-*` with the old values as fallback, so a coarse-pointer phone gets 15/13 px. Desktop
  text sizes were compared node by node on two pages before and after: unchanged.
- One phone-shell rule in the kit (`plugin-ui/lib/phone-shell`: under 640 px wide, or a coarse pointer under 500 px
  tall). A sideways phone now keeps the phone shell, top bar and status pill instead of the desktop rail.
- The palette is a full-screen search on a phone, with no key legend; results end at the keyboard.
- Keyboard hints in kit menus are hidden on a touch screen. A page title is printed once under the phone top bar
  (the `h1` stays for screen readers).
- The `+`/`@`/`/` lists have 44 px rows, 13 px labels and a 16 px radius, and stay above the composer so typing still
  filters. Edited-file counts read 12 px. The mode chip keeps "Can edit" and the model name truncates first.
- Land is a tab root on a phone (no "‹ More"); empty rows are dropped from the phone status list.

Did not reproduce: the status pill covering page content; a menu-sheet handle that does not drag.

Not done: "Land" as a header button on a phone (the workspace control's slot only renders inside the `⋯` sheet
there; jj-integration could fill the slot the phone bar already shows). Proposed, not built: tabs Threads · Inbox ·
New · More with Land under More.

For other plugins: workbench, rich-composer (four components) and onboarding still key phone layout on width alone and
should use the kit rule; the model picker's bordered card and the thread panel's white sheet are two more sheet looks;
11 px text remains in Usage chart axes, the question card header and the failure card's code.

Unverified: measured in Playwright WebKit 26.0 with an iPhone 14 descriptor, not on the device. Journeys:
frame-layout 2/2, command-palette 17/18, input-trigger 2/3, thread-sidebar's phone scenario; each failure fails at
the base at the same step. The deliverables card was checked by CSS test only.

## Destinations lane

16 revisions (`wqkuqryqtloy` … `pzwvrxmqtxyy`) in thread-sidebar, capabilities-hub, onboarding, plugin-guide and
component-gallery, plus `vwyoxqyn`, which commits the two generated catalogs (stale since the upstream base, so every
build rewrote them) and updates the onboarding test that pinned an old reach.

- One thread menu for the row and the header `⋯`: Pin, Done, Snooze, Rename, Open in side panel, Copy thread link,
  then Open in, Copy and More. Desktop-only entries and keyboard hints are hidden on the phone.
- Labels follow the glossary: Settle → Done (Unsettle → Restore), Park → Snooze (Unsnooze). Mute (silences, for a
  while or for good) and Archive (the Host verb that removes a thread from the list) keep their names. Keys, command
  ids, Host methods and tool names keep the stored words.
- Component gallery and Plugin guide sit in a "Developer" group at the end of the Settings list.
- One name for the Inbox, with its count at the row's trailing edge. Unsent drafts list under "Drafts", not Idle.
- The header shows Needs you while a thread waits on an approval; the subagent card says what the child does in
  words, with one clock.
- The failed-turns hook is published as a dshx module; one palette row per page; Settings choices use the kit
  segmented control; What's new shows five features instead of 50 commit subjects.
- `check:copy` findings in thread-sidebar: 36 at the base, 3 at the tip.

Naming caveat: Snooze is the glossary's word for a timed or until-needed hide, but Park is neither (it holds until
undone), while Mute already offers timed choices. The renames are labels only, so this is cheap to revisit.

Journeys (`DSHX_E2E_WORKERS=2`, forced): thread-sidebar 45 / 16, onboarding 5 / 3, capabilities-hub 1 / 0, traces
7 / 4, workbench 19 / 26. Every failure fails at the base at the same step, except `remote-row-verbs` and
`skill-mentions`, which pass alone at the tip, and `usage-limit-group`, which flakes at the base too. The edited
"Open in › Traces" journey step was never reached (its scenario stops earlier at the base too). Not verified: the
phone, and the translations the lane added.

## Pages lane

24 revisions (`smxssuywlkvo` … `stvukouuzryv`) in ai-accounts, usage, memory, background-jobs, multi-host,
mcp-servers, whiteboard and project-automations.

- AI accounts is colourless when healthy: kit switches, no green dots or "Connected" badge, no indigo side border;
  one header row with hairline sections instead of nested cards; the failure options in Settings sit behind one
  disclosure. One status-strip item for quota, with a plain plan name and one duration format.
- Usage leads its Cost tab with three numbers and one empty sentence when there is no usage; one-line description;
  the Purpose filter scrolls sideways on a phone.
- Memory analytics is one sentence and a plain table instead of ten icon tiles; no tool names and no filters over
  an empty list.
- Processes shows no zero-count chips; a job strip is titled by the call's description.
- Hosts: one inline verb and a `⋯` per row, "Link this machine" from a header action, plain error copy, shared
  status glyphs.
- MCP servers: one name, the list is the page, adding a server is a dialog.
- Whiteboards and Automations use the kit empty state.
- background-jobs publishes `@dshfiles/background-jobs/running-threads`; thread-sidebar does not read it yet.

Not done: cost charted in three places (#24); the retry row's route id (`chat`); the amber "10%" on model rows
(`model-effort-picker`); Secrets (#44). Agent avatars stay emoji: they are user-chosen data.

Unverified: full journey suites after the fixes (only the failed scenarios were re-run; every remaining failure fails
at the base too, except `multi-host.auto-destination` and `remote-land-page`, which stop at a harness seeding
error); the quota popover at 390 px. The multi-host and ai-accounts Host halves carry two changed strings, so a
running instance shows those only after a restart.

## Tabs lane

18 revisions (`vtwkrtvltpzy` … `ystlqzpkqnmv`) in workbench, main-tabs, dialogs and sidebar-right. All client code,
so no restart is needed.

- Both tab strips draw one shared glyph (`@dshfiles/workbench/tab-status`): ring spinner for working, indigo diamond
  for Needs you, red cross for failed, ink dot for an unseen finish. A tab and its list row now agree.
- A restored panel whose source is gone is named by its title, never its resource id, and a gone thread's page is
  replaced instead of gaining a twin tab.
- Preview tabs are muted, not italic; titles are capped and a clipped strip edge fades.
- The New tab page fills its pane and leads with views that can be opened; with no thread open it shows one muted
  line instead of twelve disabled rows.
- Toasts are plain bordered cards with a tone icon (colour only on failure), one at a time with the rest queued,
  lifted clear of the composer. App dialogs use the 12 px radius.
- The tab menu keeps tab and thread verbs at the top and groups docking under "Layout"; "Close panel" merged into
  "Close tab".
- The phone thread panel sheet has a 16 px radius, no docking `⋯`, and no leftover "New tab" beside an opened view.

Did not reproduce on this base: the "N working" strip item doing nothing on click, and Workbench offered as a thread
panel.

Not done: the lone right-sidebar toggle on the new-thread screen; an edge fade in main-tabs' legacy strip; a "New
tab" chooser saved beside a view in an old layout stays until closed. The New tab page still lists about 40 views in
one flat grid, with mixed naming ("Observe › Usage" style beside bare "Quota", "Revision graph", "Traces"): that is
step 10.

Proposed, not built: a fixed segmented row (Changes, Files, Jobs, Cost, Context) in the phone sheet.

Unverified:

- Journeys: dialogs 2 of 2. main-tabs 14 of 15; the failure stops at the sidebar "More" button at the base too.
  workbench 19 of 45; all 26 failures fail at the base too, 18 of them at the "two real threads" setup.
- The "Layout" step added to five journey files ran green in two scenarios only; three catalog walks with it were not
  walked green.
- The toast's phone position after its last change is unit-tested only. WebKit was not used.

For other plugins, not started: chooser labels ("Browse files in this session's workspace" is core; "Jujutsu",
"Editor … with Monaco"); plugin-ui dialogs default to 8 px corners; thread-sidebar could export its failed-turns
hook, which main-tabs restates.

## Settings lane

19 revisions (`ymyryuvqqtlp` … `pwxsxvlpyyxl`), all in settings-shell apart from reach and journey steps. Settings went
from 62 navigation rows in 11 groups (General 15, Other 12) to 41 rows in 10 groups (General 8, no Other). A row is now
label, description and control: the key and "Default" source lines are gone, a package description is never shown as a
section description, byte and millisecond values show in one readable unit, a JSON-edited setting keeps its last valid
value, and a schema's `collapse()` hint folds a field under Advanced. `settings-groups.test.ts` fails when a namespace
would land in Other and says which table to edit.

Deliberate differences from the audit's proposals:

- Thread list stays its own entry (about 55 controls); Layout holds Main tabs, Docked panes, Thread panel, Status bar.
- Extra merges: Web search and fetch, Checks and tests, Diagnostics; Command palette under Keyboard shortcuts.
- The audit quoted "Max request files bytes 13421772"; the default is 134217728, shown as 128 MB.

Not fixable from settings-shell:

- The Built-in plugins card grid and the "new sessions" row are native core sections with no fork here.
- 42 namespaces now show no description: each owned plugin needs a schema `.description()` or a `locale/en.json`
  title and description. Nine are core rows.
- Fields to mark `.collapse()`: traces (host, port, forward URL, retention, stall), agent-telemetry, annotations
  (Chrome path, CDP port, profile dir), web-fetch-readable, worktree-memory, sidebar-right, project-automations,
  workbench demo panels.
- Five plugins keep a master `enabled` switch that repeats the Plugins page (main-tabs, turn-summary, agent-plan,
  tool-meta, test-runs).
- thread-sidebar's own section still uses a black segmented control and says "session" in three labels.

Follow-ups, closed in two more revisions (`nktyxmlnqmrl`, `lzonzlnkllol`), each scenario run at the tip and at the
lane's base:

- secret-catalog: one of the three scenarios passes at both; "Set up Jev from the latest chat turn" and "Create and
  bind from a marked secret-reference field" fail at the base too, at the same step.
- settings-web-search: its journey failed at the base on a stale row label and now passes.
- workbench: the journey holding the renamed Settings click fails at the base too, at a later step where the URL's
  thread id does not change after New thread.
- The `workbench/main-tab-parity` and `main-tabs/main-view-tabs` reach walks pass after their stale openings were
  repaired.

Phone layout was checked in Chromium at 390 px only.

## Follow-ups

Found by the lanes, outside their scope; none started. Grouped by owner.

- **jj-integration:** "Land" as a header button on a phone (fill `conversation.session.header.changes`, which the
  phone bar already shows); the thread list's inline Land runs without the confirmation the header button has; two
  black Land buttons when the Changes view is open; "Download thread log" in two menus; Host strings still say
  "revision(s)" and "rebased".
- **thread-sidebar:** read `@dshfiles/background-jobs/running-threads` so a thread with a running job is Working; the
  "Restart" status item renders an empty button when there is nothing to restart; three "session" strings left.
- **plugin-ui:** the cost and trace waterfall summaries use ALL-CAPS truncated labels; `ToolCard` draws a green check
  on a passed card; `DialogContent` defaults to 8 px corners; `Page` tabs cannot act as navigation links; no duration
  utilities.
- **chat and dshx:** a transcript-only tool label (`tool.label(output)` in `presentationMeta`) so a tool row can say a
  sentence without hiding data from the model; the retry row shows a route id instead of the account name; the
  duplicate "Ask question · waiting · Answer" row is core (`dsh-client-ui-tool`).
- **Phone width rules:** workbench (`dockview-theme.css`, `phone-sheet.tsx`, `header-seat.ts`), four rich-composer
  components and onboarding's `reach-model.ts` key on width alone instead of the kit's phone-shell rule. 11 px text
  remains in Usage chart axes, the question card header and the failure card's code.
- **Other:** Backlog's status groups colour Done green and In progress amber; the model picker's amber "10%" per row
  and its bordered card in the sheet; package descriptions shown in Getting started; durations read "120ms" where
  traces journeys expect "120 ms"; cost charted in three places; the row menu's Snooze label for Park (see
  [Destinations lane](#destinations-lane)).
- **Harness:** many journeys fail at the base on the shared "start a second thread" and "Add a project" steps;
  catalog `reach` walks drift silently and need a periodic browser walk.

## Open items

- **O1.** Decided 2026-11-16: the reports and screenshots stay out of the repository.
- **O2.** Confirmed on the owner's iPhone 2026-11-16: no list appears when typing `@`. The fix needs the same check
  on the device once it is served.
- **O3.** Policy for the 27 native forks: restyle them, or accept upstream styling and say so in DESIGN.md.
- **O4.** D could not confirm from source which controls are native-core contributions (the second header `⋯` is
  one; A1 saw it rendered).
