# Unslop: UI/UX audit and work list

Audit date: 2026-11-16, on the fork's `main` at `wqstyzvl`. This file is the audit and the work list that follows
from it. The fixes are stacked on upstream `astahmer/dshfiles` `main` at `b9ef35a3` (local bookmark
`unslop-upstream-base`), one revision per change, not on the fork's `main`. Nothing is pushed or landed. Authority for every rule cited: [DESIGN.md](../../DESIGN.md) and the
[UX plan](../../docs/ade-ux/README.md).

**Resume here:** step 1 is done; steps 2–14 are open. See [Work list](#work-list).

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
| 2    | Deletions on the main surface: hide "Context injection" rows, stop the timing overlay on card headers, one header `⋯` with Copy link and Pin inside it, one `⋯` instead of the row hover strip. | U3, N3, N4, N5 | small |
| 3    | Tab strips use the shared status glyph; one projection for working and needs-you counts; failed stays Failed.                                          | N1, N2, M5, N7    | medium |
| 4    | Failure card: one sentence, one cause-matched button, details folded.                                                                                  | M4                | medium |
| 5    | Inbox question items render the question's own options; "Answer" lands on an answerable card; phone question card gets one scroll.                     | M1, M2, M3, M8    | medium |
| 6    | A primary "Land" in the header and as the row's inline verb when there is work to land; settle what the "+N −N" chip counts.                           | M6, M7            | medium |
| 7    | Settings rows: hide key and source lines, no package-description fallback, humanise units and enums, regroup the nav with no "Other".                  | P1, P2, P3        | medium |
| 8    | Do not render zero-count chips, tiles and stat blocks.                                                                                                 | P6                | small  |
| 9    | AI accounts onto the kit switch and the colour rule.                                                                                                   | P4                | small  |
| 10   | Developer pages behind the "Plugin development" pack; remove Capabilities hub; hide Plugin Market when absent.                                         | N9                | small  |
| 11   | Copy: catalog summary cap, error strings with a next step, `compactJson` renders, six status words, glossary in native forks.                          | C1–C8             | large  |
| 12   | Backlog, History, Source control and Traces onto `Page`.                                                                                               | P5, P7, P8, P12   | large  |
| 13   | Phone: type scale, landscape shell, thread panel sheet, palette as full-screen search, hide keyboard hints on touch.                                   | U7, U8, N12       | large  |
| 14   | Guardrails: both ratchets into `check:green` after re-baselining, widen `copy-check`, add rules for shadows, durations, viewport variants and solid status fills, repair the catalog walks. | G1–G7 | medium |

## Open items

- **O1.** Decided 2026-11-16: the reports and screenshots stay out of the repository.
- **O2.** Confirmed on the owner's iPhone 2026-11-16: no list appears when typing `@`. The fix needs the same check
  on the device once it is served.
- **O3.** Policy for the 27 native forks: restyle them, or accept upstream styling and say so in DESIGN.md.
- **O4.** D could not confirm from source which controls are native-core contributions (the second header `⋯` is
  one; A1 saw it rendered).
