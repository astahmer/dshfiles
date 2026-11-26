# Unslop: UI/UX audit and work list

Audit date: 2026-11-16, on the fork's `main` at `wqstyzvl`. This file is the audit and the work list that follows
from it. The fixes were built on upstream `astahmer/dshfiles` `main` at `b9ef35a3` and rebased on 2026-11-24 onto
`ecdb9212`, one revision per change, not on the fork's `main`, so they merge into upstream as a fast-forward. They
are the draft PR astahmer/dshfiles#271 (branch `contribute/unslop-ui` on the tbrowang fork); nothing is landed. Authority for every rule cited: [DESIGN.md](../../DESIGN.md) and the
[UX plan](../../docs/ade-ux/README.md).

**Resume here:** round one's 14 steps and round two's five lanes are done; round three's five lanes are done; round four's five lanes are done (see [Round four](#round-four)). Round two started 2026-11-24 after feedback that the monochrome changes
were dull: bring purposeful colour back and make daily use smoother, without undoing upstream's coloured project
chips (#287). See [Round two](#round-two). Round one's leftovers are under [Follow-ups](#follow-ups).

## Round five

Started 2026-11-25: make the UI look better and easier on the eyes, with colour where it helps, judged by a council.
A fixed screenshot set (10 desktop screens and 4 phone screens, light and dark) is captured from a scratch DSH by one
script in `.cache/unslop-audit/r5/capture/`, so every round is scored on the same screens and data. The council is
Claude Opus 5.5, GPT-6.2 Sol and Mistral Large 4 at high effort (core), with GLM-5.3 high as a non-blocking seat. The
round ends when every core seat scores the set at least 9/10.

Capture: `node .cache/unslop-audit/r5/capture/capture.mjs <workspace> <out-dir>` (about 5.5 min) seeds three projects
(`billing-api`, `web-app`, `docs-site`), eight threads in every status, a rich transcript with a running subagent and a
background job, backlog items and usage, and switches dark through Settings › Appearance. Two runs differ only in live
clocks. Round 0 (the PR tip before any round-five change) is in `.cache/unslop-audit/r5/round-0/`. Found while building
it: tool-meta's "Waiting for approval" chip shows outside its hidden parent in a background tab; the start screen
counts 2 threads needing you while the Inbox counts 3.

| Council round | Claude Opus | GPT Sol | Mistral Large | Notes |
| --- | --- | --- | --- | --- |
| 1 (round-0 shots) | 6.5 | 6.5 | 7.5 | GLM 6.5 (non-blocking): coloured pixels cover 0.03–0.5 % of 12 of 14 screens |
| 2 (round-1 shots) | 7.5 | 7.5 | 8 | GLM 7.5: the round-1 fixes are in the pixels; Needs-you washes too faint to see |
| 3 (round-2 shots) | 7.5 | 8 | 8.5 | colour now reads; consistency (chrome, widths, controls) and phone space remain |
| 4 (round-3 shots) | 8 | 8 | 8.5 | one system now; phone transcript clip, two Settings layouts, rail surface, muddy tones remain |
| 5 (round-4 shots) | 8 | 8.5 | 8.5 | no redesign needed; page frames, control heights, phone density, colour in persistent chrome |
| 6 (round-5 shots) | 8 | 8.5 | 8.5 | colour and type at the bar; craft and alignment (phone Inbox head, Settings header edge, indigo selection) |
| 7 (round-6 shots) | 8.5 | 8.5 | 8.5 | indigo still on on-states and the theme card; one header frame; phone fold; one identity mark per page |
| 8 (round-7 shots) | 8.5 | 8.5 | **9** | Mistral at target; grammar left: one colour layer per attention row, filter-row triggers, phone Inbox context |
| 9 (round-8 shots) | 8.5 | 8.5 | **9** | phone Inbox head agreed by all; Settings width, selected-place colour, phone shell grid |
| 10 (round-9 shots) | 8.5 | 8.5 | **9** | control chrome too loud, phone toolbar and dock, selection bar bends, Review icon |
| 11 (round-10 shots) | 8.5 | 8.5 | **9** | marker crowds leading glyphs, quiet triggers vanish at rest, light diff, Usage repeats, prose measure |
| 12 (round-11 shots) | 8.5 | 8.5 | **9** | selection too quiet on glyph rows, dock edge regression, Inbox verbs, Usage table, phone tab tone |
| 13 (round-12 shots) | 8.5 | 8.5 | **9** | palette dark selection, phone tab pill, chart headroom, New thread chips, send seat, phone Inbox fold |
| 14 (round-13 shots) | 8.5 | 8.5 | **9** | all three: project names cut in attention rows, a stray dash on New thread; one attention meta wording |
| 15 (round-14 shots) | 8.5 | **9** | **9** | Sol and Mistral at target; Opus: rail marks clipped (regression), Inbox tally and verbs, palette wording |
| 16 (round-15 shots) | **9** | 8.5 (Astra) | 8.5 | Opus at target; Astra (new GPT seat): composer, answer-first Inbox, installed plugins first; Mistral: colour (owner kept the restraint) |
| 17 (round-16 shots) | **9** | **9** (Astra) | **9** (Fable, for Mistral) | **Target met.** Mistral's provider failed every request; the owner seated Claude Fable 5.2 for this round |
| 18 (round-17 shots) | 9 | **9.5** (Astra) | 9 (Fable, for Mistral) | Round six, target 9.5; all seats pass the subagent model; shared: phone failed Inbox card, AI accounts column, secondary buttons |
| 19 (round-18 shots) | 9 | **9.5** (Astra) | 9 (Fable, for Mistral) | No increase (first). Shared: the Inbox's folded brand overhang; Opus: sidebar content presses against the new brand hairline (regression) |
| 20 (round-19 shots) | **9.5** | **9.5** (Astra) | **9.5** (Fable, for Mistral) | **Round six target met.** Mistral's provider failed every request this round; Fable held its seat |
| 22 (round-20 shots + subagent shots) | 9 | 9 (Astra) | 9 (Fable, for Mistral) | Round seven. 01–14 hold 9.5; subagent shots 7.5–9: phone dock rows lose task names, failures hard to see, four counts, phone child doesn't name its parent |
| 23 (round-21 shots + subagent shots) | 9 | 9 (Astra) | **9.5** (Fable, for Mistral) | Child views at 9.5; the parent views hold 9: transcript group shows no live state, failed count drawn four ways, text cut under the desktop dock, the phone dock is three boxes |
| 24 (round-22 shots + subagent shots) | 9 | **9.5** (Astra) | **9.5** (Fable, for Mistral) | Astra and Fable at target; Opus: transcript model/outcome columns, the failed child's model, the phone dock end, one selected look, one clock |
| 25 (round-23 shots + subagent shots) | 9 | 9 (Astra) | 9 (Fable, for Mistral) | No increase (first). All three: the phone transcript row for the call that never started clips its title |
| 26 (round-24 shots + subagent shots) | **9.5** | **9.5** (Astra) | **9.5** (Fable, for Mistral) | **Round seven target met.** All three answer the owner's question yes on desktop and phone |

Round 1 findings, merged in `.cache/unslop-audit/r5/council/round-1-fixes.md`: colour only in 8 px glyphs while black row
buttons are the loudest thing on screen; surface steps too close (dark panel 1.04:1 against bg); project tones are raw
rose/amber/green that read as Failed or Warning; the Usage chart is one flat accent slab; sidebar titles cut to about 12
characters; Settings has three navigation columns; phone dock fragments, double focus ring, status pill over content.
Lanes: K kit and tokens done (11 revisions `ssppouml` … `toulklss`: ProjectMark and status-safe project hues 225, 110, 55,
305, 340, 195; attention and danger-tint buttons; selected wash; wider surface steps and faint text at AA; 10/14 px status
marks; one focus ring on compound fields; data ramp from identity hues; softer scrim; page 24 / section 20 / stack 16;
core switches on control-on; DESIGN.md). Attention text and project letters are pulled toward ink to hold AA (the
specified #3e5ed8 read 3.8:1 on its tint). C transcript done (5 revisions `orpmprwn` … `qvlnrkrp`: one phone Live work
row, Back to bottom in its own band, phone composer shows the brand mark and mode icon, prose at 1.62, raised dark code
cards, ProjectMark on composer chips). P pages done (11 revisions `lzrzzppx` … `ontvmoyk`: Usage bars capped at 44 px with
a value label, teal-first series, one segmented style, 20 px lead numbers; Inbox cards with a status-tinted band, one
attention verb each and utilities in ⋯, phone answers as 44 px rows; phone status pill clears the home indicator; Settings
selected wash and a checked Appearance card; AI accounts rail as a selector with picker checkboxes; Backlog titles in ink
and tinted tags; calm dark diff tints). T thread list, tabs and palette done (5 revisions `xpkytmyw` … `nrpzywvt`: title and time on line 1, the verb on line 2 as
an attention or danger-tint button, ProjectMark tiles, persistent Needs-you and Failed washes, tinted group count chips,
selected wash on the open thread and the active rail item, one Settings navigation, inactive tabs on the panel step with
the project tile, palette status hues kept and one prefix hint). Follow-up: chat's "When to Collapse
Work Details" in sentence case.

Round 2 findings, merged in `.cache/unslop-audit/r5/council/round-2-fixes.md`: selection louder than attention (the dark
selected wash outshouts 6 % Needs-you washes); Settings still shows two navigation columns; phone chrome takes about a
quarter of the thread screen; dark diff body is off-ramp near-black with invisible add/remove tints and light syntax at
2.79:1 on deletions; Inbox cards washed whole instead of a header band; Usage has six segmented controls and 2.95:1 axis
labels; Backlog capture box and repeated author; the active tab label dimmest. Lanes A kit/diff/syntax, B navigation
and list, C transcript/Inbox/phone shell running; D done (5 revisions `xzmusyts` … `uwquwxrt`: Usage underline section tabs,
two segmented controls, granularity and grouping as selects, neutral KPIs, plain total; Backlog one-line capture box
with a placeholder (blank Enter lines were being saved as a draft), one row grid, no repeated author, All/Inbox in the
filter; Review ProjectMark, sans counters, one Reviewed checkbox per file, card hugs its files; AI accounts 300 px rail,
DeepSeek mark, provider marks on model ids, "In picker"). Follow-ups: DESIGN.md's "no underline page tabs" vs Usage;
brand marks duplicated in model-effort-picker and ai-accounts; SpendMap needs a no-gauge option.
A done (9 revisions `stttokqr` … `zmnllvmq`: Needs-you and Failed wash tokens; a quieter selected wash with a 2 px
leading marker and 550 title; `StatusCount`; faint text at AA on bg, panel, raised and every wash; chart labels at
secondary ink; one syntax pair for transcript and diff, diff body on the ramp, 12 % add/delete tints, `+`/`−` marks; core
Plugins page on the shared inset with identity-tone tiles and one Experimental chip per group; Page tab strip no longer
scrolls vertically). C done (6 revisions `ouqmrunl` … `wnxxurkt`: phone status pill only on Threads and Inbox; jump to
latest on the dock edge with no faded band; one 720 px transcript column shared by code, cards, dock and composer; one
Inbox card with a status head band, "Recommended" spelled out, a StatusCount title, phone Start triage in the top bar;
sentence case for the collapse setting). agent-questions' Host provider changed: a restart is needed. B done (14
revisions `tqyxlvut` … `yvmluxrx`: the destination column folds to the rail while Settings or a one-page destination
is on stage, and the Settings page lists the destination's other pages; Needs-you and Failed rows on the wash tokens,
the selected row on the quieter wash plus marker, Failed titles wrap, whole-unit times, a real chevron, StatusCount
group chips; the subagent wait shown once in the header; the active tab label in ink at 500 in main-tabs and Workbench;
palette with one keycap, relative times and one frame; Settings theme swatches and stacked narrow rows; new-thread
starter chips kept after the first thread; dshx seed and e2e helpers reopen the folded Settings list).

Round 3 findings, merged in `.cache/unslop-audit/r5/council/round-3-fixes.md`: the folded rail drops its labels and the
wordmark, so the chrome changes between destinations; selection still shares the Needs-you hue (now neutral with the
indigo marker); no shared page container or header (Settings General has none); three tab and two select styles; two
diff-count formats; the phone status pill band and the jump band take a row; Inbox counts a Failed item as Needs you;
rail, starter chips, tool rows and Usage flows still ink-only (now identity tones). Lanes A kit, B chrome and Settings,
C transcript/Inbox/phone, D Usage/Backlog/AI accounts/Plugins. The first attempt of three lanes failed at start (four Opus
lanes launched at once; quota was fine), so they were restarted one at a time. All done: A kit 13 revisions
`kuvzuspm` … `xrpvrwmz` (neutral selection + `selected-card`, nav identity tones, `DiffStat`, band wash, one field look and
`UnitInput`, `Page` width/statusCounts/tabs rule and `PageHeader`, softer dark primary, raised dark dialogs and Kbd,
`ToolCard kind`, DESIGN.md); C 13 revisions `qnkokpyl` … `mkwwuvxq` (phone status as a top-bar button with no band,
floating jump button, flat Live work row, whole "Worked for", hover-only reply actions, one 680 px column, DiffStat in
the transcript, tool-kind glyphs, Inbox counts ◆2 ✕1 and list-aligned actions, starter chips, 312 px default sidebar on
wide windows); B 11 revisions `vtvtkulr` … `xotvlzox` (one labelled rail open or folded, rail tones, Needs-you rows without
prefixes, active phone tab tone, Settings page header, kit field look and selected card, palette on the dialog surface,
status button in the Threads bar); D 15 revisions `vkxupnzr` … `kktmpwmz` (Usage Overview, grouped KPIs, seven-day ticks,
flows in series colours; Backlog underline tabs and a 920 px lane; AI accounts Models without the form; Plugins in a
920 px lane with tones by name; one +N −M everywhere including PatchView; the scratch seed's wizard race). The lead
removed four lint findings lane B left in two tests. Follow-ups: `--text-display` and the container-query tiers are rem;
native Bash and dock rows lack kind glyphs;
deliverables ReviewTab and jujutsu still draw old diff counts.

Round 4 findings, merged in `.cache/unslop-audit/r5/council/round-4-fixes.md` (captures are 2×: CSS px = shot px ÷ 2; an
earlier 0.77 scale claim was wrong): the phone transcript is clipped above the dock and the jump button covers text;
Settings has two layouts (in-page list on General, side column elsewhere), now one side column; the rail surface
changes tone when the column folds; olive and brown rail tones read muddy; the Inbox badge is an ink blob over its
glyph; plus Inbox card order, transcript rhythm, Usage colour consistency, AI accounts tabs, Review action weight,
Backlog tag stability and Plugins row heights. Lanes A kit, B navigation/Settings, C transcript/Inbox/phone, D pages,
started a couple of minutes apart. All done: A 9 revisions `xkxvuovz` … `kuoxkpou` (AttentionBadge, `text-heading`, re-picked
rail tones with a chroma floor or the sRGB gamut edge, softer light primary, dark dialog fill clear of the scrim, DESIGN.md,
`text-query`, `cn` that keeps kit type and weight steps); C 7 revisions `kpnppyyt` … `lmpxzvzk` (phone transcript ends
in a fade, jump control in the dock head, a finished turn 24 px above the dock and edits named once, Inbox cards with the
title once and a one-row failure, ProjectMark in the new-thread heading, no trailing status divider, the Inbox badge
beside its glyph); D 8 revisions `ptskvymy` … `pnssqzsk` (one Usage filter row and one series colour per model across
views, AI accounts underline tabs and a labelled switch, Review action weights and a 13/18 file name, fixed tag tones
and one shared time per day in Backlog, even two-line Plugins rows); B 11 revisions `nrprqszo` … `zxmzotzz` (one
Settings navigation in the side column, one rail surface, 680 px Settings fields, separate phone Back and centred
title, denser phone list, 10.5 px rail labels, a 48 px palette search lane). Follow-ups: shell tone chroma 0.09; native
Bash rows without a kind glyph; "Worked for" not folded into the summary line; the phone Ready row still cut at 390×844;
the first-run wizard can open after the seed's dismissal window.

Before round 5 the lead fixed the phone Inbox bar, whose status button ran over the centred title (`vyyvsrnz`). A DOM
measurement in a scratch DSH (1440×900, DPR 2) settled the scale question: root font 16 px, no zoom or transform, rail 56
and the Settings column 680 CSS px, so desktop shots are exactly 2×. Round 5 findings, merged in
`.cache/unslop-audit/r5/council/round-5-fixes.md`: two page frames (880 lane, 1200 wide), one 32 px control height,
nav and stage surface roles, the destination tone on the active tab, Settings glyphs and a phone drill-down, a 60 px rail
with 11 px labels, the phone list's trailing column, the phone dock's chevrons and model label, Inbox verbs in the card
head, a Usage stat card, Review's base control, Backlog alignment and Plugins row affordances.
All four lanes done: A kit 8 revisions `wzonywpw` … `krxsuvsn` (lane 880 and wide 1200 frames, nav and stage surfaces,
one 32/44 px control height and 8 px radius, a disclosure chevron, a locale clock formatter, ProjectMark at 18 %, light
washes at the sRGB edge with faint text at AA); D 10 revisions `wktllsxm` … `rrzswzpz` (ModelMark and brand colours in
the kit, SpendMap `leafMaxWidth`, Usage stats card and brand marks, AI accounts one field look and marked selection,
Review base once and one review control, Backlog start-aligned day divider, Plugins chevrons, a visible quota meter);
B 10 revisions `umkzmpkp` … `wvlolmyw` (approval subtitles, 60 px rail with 11 px labels, phone two-row thread rows, the
destination glyph on the active page tab, Settings glyphs and surface roles, phone Settings drill-down, theme-card
previews, list fade); C 12 revisions `ktsynvnn` … `zlqqrlkl` (60 px folded rail, model name and Can edit on the phone bar,
an arrow jump control, unwrapped code with an edge fade, 24 px turn rhythm, Inbox verbs in the card head, centred New
thread, full-width header rule, locale clock times). settings-shell needs a restart when this lands.

Round 6 findings, merged in `.cache/unslop-audit/r5/council/round-6-fixes.md`: indigo only for attention (ink selection
marker); a field boundary at 3:1; a 960 px lane on wide panes; dark layering; a faint cool prompt bubble; the phone Inbox
card's title on its own row with the verb below; the Settings header on the field column, per-group tones and distinct
glyphs; the status gauge leading on every phone root tab; one live-work dock; Usage in one card rhythm; Review's file
header; Backlog's open glyph and time runs; the Plugins title weight.
All four lanes done: A kit 7 revisions `yvvrllwn` … `vmvvuxpm` (ink selection marker, `--dshx-field-border` at 3:1, prompt
fill, lane caps content 880/960, dark nav surface 0.225, Idle and Ready glyph sizes, DESIGN.md); B 14 revisions `nsxkzoml` …
`mrrzorxr` (hero Inbox split, phone gauge leading, Settings header on the field column, per-group glyph tones, group spacing
and child indent, no duplicate Settings title, Transcript heading in General, tab strip on the nav surface with a compose
glyph and ink tab mark, 44 px phone search); C 7 revisions `yplyvmmz` … `pqtukkty` (phone Inbox title row and bottom verbs,
one desktop live-work dock, a Wrap cue on overflowing code, a truly centred New thread, one work-strip separator, the
prompt tint, the status strip on nav); D 14 revisions `tskxtrqm` … `vtvwwvyk` (Usage in one card rhythm, Review's file
header and Mark reviewed edge, Backlog solid open ring, time gutter, accent tab bar, Plugins title and lane). The lead fixed
one lint finding in a new test, the Settings font size field border, and the diff collapsed-lines bar inset.

Round 7 findings, merged in `.cache/unslop-audit/r5/council/round-7-fixes.md`: ink for every non-attention on-state
(checkboxes, switches, the chosen card, underline tabs); a destination glyph in its tone before each page title; one 880
header frame (Settings rows widen to it, Inbox actually renders at it); the Settings nav header on every page; the phone
Inbox, thread list and transcript fit their folds; short code wraps on narrow panes; filter triggers in the field look.
All four lanes done: A kit 8 revisions `zrzxwxvx` … `twqlnmzt` (ink on-states and tab bars, page title mark, field
trigger variant, diff collapsed-lines bar and visible dark diff bands, DESIGN.md, mark centred on the title line, Toggle
labels centred); B 11 revisions `yqvrlpxt` … `zwvttnmn` (Settings on the 880 lane with right-aligned controls, column head
on every page, h1 by category, Basics heading, field-edged search launcher, phone list fold, phone thread status line);
C 6 revisions `wqvnrlmq` … `mmuvsnns` (Inbox title mark and one card head order, phone Inbox fits its fold, 36 px dock
fade, short code wraps on phones, work strip without chevrons, dock edges and glyph column, New thread centred as one
block); D 9 revisions `rszuruly` … `xlwzstml` (ink tab bars, compact effort selects, Plugins Refresh, page title marks,
field-look filters, Usage stats footer and 190 px chart, coloured breakdown cards, one Mark reviewed edge). The Inbox
lane is 960 px on its wider pane by rule, not narrower than Backlog.

Round 8 findings, merged in `.cache/unslop-audit/r5/council/round-8-fixes.md`: one colour layer per attention row (text
verbs), filter-row trigger grammar, the dark search edge that did not render, phone Inbox project and kind and the full
band strength, one Inbox card structure with verbs beside their evidence, one dock grammar attached to the composer,
rail tones ≥ 40° apart, every Settings group tinted, Settings row dividers and type steps, switch off boundaries.
All four lanes done: A kit 7 revisions `qyvqtklz` … `nkupyqwu` (attention-text and danger-text verbs, rail tones 40° apart
with Inbox in secondary ink, selected card edge and check only, Settings row utilities, switch off edge, code hang from
the line's own indent, DESIGN.md); B 7 revisions `qvysksxx` … `tlkvvyrp` (field-look search and filter triggers, text verbs
and secondary previews on rows, one tone per Settings group, Settings row grammar); C 7 revisions `pzpovtrn` … `ovlvtort`
(one Inbox card structure with verbs after their evidence, one-line phone heads, icon Start triage, New thread 305/305,
16 px phone fade, flat jump button, one dock row grammar attached to the composer, CodeIndent wired); D 10 revisions
`zurvrquo` … `lwooopws` (Re-index in the page menu, More numbers in the stats corner, active spend nodes edged in their
series colour, Backlog rounded-square statuses and field triggers, Review's labelled controls and base combobox, leaf
title marks for AI accounts and Plugins). The lead raised the spend node edge to the full series colour (60 % was
2.1:1) and taught the capture script the Re-index menu. Backlog's "Inbox" view is not renamed: it lists attention items.

Round 9 findings, merged in `.cache/unslop-audit/r5/council/round-9-fixes.md`: one two-line phone Inbox head with the full
title; a labelled phone Triage button; Settings on a 720 px form frame with one select width; a selected place carries its
tone (tile behind the glyph on selected nav rows and the active tab, tones on the phone tab bar); a calmer dark on-state;
one phone gutter and header grid; Usage stats matching the chart; Backlog's status as a menu and its view renamed Triage.
All four lanes done: A kit 6 revisions `ksownsxp` … `tkqyumnx` (PlaceGlyph selected-place tile, 720 px form frame,
field button size, dark on-state at L 0.82, 1.5 px card edge, DESIGN.md); B 8 revisions `upkyyxqn` … `zlwrrxpy` (tones on
every phone tab glyph, one toolbar field height and the 12/24 phone gutter, Settings on the form frame with 176 px
selects, Developer head, list fade that switches off under a selected row instead of scrolling, phone Settings inset
separators, place tiles on selected side-column rows and the active tab, leaf glyphs on the AI accounts and Plugins
tabs); C 7 revisions `mornvuwz` … `qrlrryzt` (two-line phone Inbox heads with the full title, mono command block, worded
Triage, Turn failed and a text Review, phone Live work attached to the composer, arrow-down-to-line, the phone gutter on
Inbox and transcript); D 6 revisions `tnskmzqs` … `nokkloqo` (one edged spend leaf, Totals header with Cost/Tokens/
Requests, Backlog status menu and Triage view, toolbar field heights, Show this account / Show model with a hidden note).
Follow-ups: phone Settings › AI accounts stacks two back headers; Usage's default chart metric is Cost.

Round 10 findings, merged in `.cache/unslop-audit/r5/council/round-10-fixes.md`: quiet filled triggers with the 3:1 edge
on text fields only; a one-row phone thread-list toolbar; a clean phone dock edge with an ArrowDown jump; a straight pill
selection marker, none where a place tile shows selection; the Review icon regression; a status tally on the phone
Inbox's Needs you; a 640 px palette; one Usage breakdown dimension; quieter AI accounts controls; Backlog's status button.
All four lanes done: A kit 13 revisions `wvssxomp` … `xplsqvvn` (quiet filled triggers with the 3:1 edge on text
fields only, a straight 3×16 selection pill skipped beside a place tile, one segment thumb in both schemes, a compact
phone tab tally, one Kbd chip, 18/600 settings headings, calmer dark diffs with lifted changed words, 12 px chart text,
DESIGN.md); B 9 revisions `lmnlnkss` … `kuxoykot` (one-row phone toolbar with a scope button, side-column glyphs sized by
their seat with Review on the Land glyph, smaller theme cards, a Preferences head, a 640 px palette with kit Kbd chips);
C 6 revisions `rnzslnom` … `omlyxyvu` (28 px phone dock fade, a round ArrowDown jump, a 76 px composer, the Needs you
tally, a framed 44 px Triage icon, tighter card heads, one composer chip ink); D 7 revisions `wylnxqnk` … `vlsuqlww`
(Plugins switches on the title line, Backlog ring status button, one AI accounts inherit caption, SpendMap segments
picker and Usage's one-dimension breakdown). Review's Compare against keeps its edge: it is a typed field.
Follow-ups: thread-sidebar `host.test.ts` fails 2 tests in isolation on the round base too (pre-existing); the phone
Triage icon has no visible label on touch; Usage has two grouping controls (toolbar By and Breakdown by).

Round 11 findings, merged in `.cache/unslop-audit/r5/council/round-11-fixes.md`: no selection pill on rows that start with
a glyph or tile; a resting hairline on quiet triggers and the field edge on the empty composer; a stronger light diff;
one-row Usage breakdowns and one toolbar label grammar; one verb slot on desktop Inbox cards; inherited AI accounts
effort as text; a ~72-character prose measure; a worded phone Triage and a Filters scope button.
All four lanes done: A kit 9 revisions `nsvtwtzy` … `uqzzqnpq` (marker skipped beside a leading glyph with a
MARKER_KEEP exception for attention rows, a resting hairline on quiet triggers, a typeable combobox rest look, a 16 px
checkbox, light diff at 16 %/34 %, quiet peek choices, DESIGN.md); B 6 revisions `zkrtwknt` … `rzytprus` (152×80 theme
tiles, one-line desktop question previews, a Filters scope button in a 48 px band, no pill beside leading glyphs in the
list and palette); C 7 revisions `owxtmrut` … `soynztwr` (worded phone Triage in the top bar, one verb slot on desktop
Inbox heads, quiet question options, the composer's 3:1 edge, the phone Live work strip on nav with a footer dot, prose
at 36em); D 7 revisions `ltnpxuux` … `wvsvtuyk` (a one-row single-entry breakdown, one filter label grammar, outline
plugin tiles in their group tones, Compare against at rest, quiet inherited effort and dense checkboxes).

Round 12 findings, merged in `.cache/unslop-audit/r5/council/round-12-fixes.md`: a neutral selected edge and a palette
↵ for glyph-leading selections; quiet dock dividers (a round-11 regression); one Review verb style on head bands; the
Usage table aligned and bars on tracks; Backlog tabs that scroll instead of clipping; the phone tab tone on the current
tab only; New thread's Resume and Inbox as chips; a tighter phone Inbox; DESIGN.md synced on Triage.
All four lanes done: A kit 4 revisions `ykvmwprs` … `xumnysrz` (selected edge at ≥ 3:1 on the wash, band-tinted
verbs with AA band text, softer light dense checkbox, DESIGN.md); B 5 revisions `tkususoz` … `lyyxpzks` (palette ↵,
current-tab-only phone tone, selected edge on glyph-led rows, kind · project on desktop Needs-you rows, pinned phone
verbs, StatusCount on the New thread Inbox chip); C 5 revisions `ylyrnmvl` … `ntorpkwr` (quiet dock dividers, one band
Review verb, a phone Inbox whose failed title clears the tab bar, Resume/Inbox chips); D 6 revisions `oqovxxky` …
`nowlvzwn` (Usage table aligned, share bars on tracks, Backlog tabs scroll with a fade, capture field edge, quiet status
column, Provider default · Auto, selected edge on accounts, three-line plugin summaries).
Follow-ups: the committed thread-sidebar `phone-tab-bar.png` predates the current-tab-only tone; Usage's day labels
overlap at 390 px.

Round 13 findings, merged in `.cache/unslop-audit/r5/council/round-13-fixes.md`, follow Opus's and Sol's own
minimum-for-9 lists: a visible dark palette selection, one neutral active pill on the phone tab bar, ProjectMark in the
desktop attention slot, a roomier phone Inbox fold, `.nice()` chart domains and a carded distribution table, one chip
style on New thread, a seated send button, the selected edge only where no place tile shows selection, a one-line phone
thread header, and two AA fixes (composer hint, side-column hover labels).
All four lanes done: A kit 5 revisions `pyylpkxx` … `qpumlzss` (AA faint ink on nav hover, a lighter dense checkbox, a
grey modified glyph, `Button variant="bar"`, DESIGN.md); B 8 revisions `rpymllzy` … `lmlypnrq` (palette selected edge,
one neutral phone tab pill, kind · project attention rows, 12 px group gaps, no edge on place-tile rows, quieter Settings
group heads, one-line phone thread bar, matching hero chips); C 9 revisions `mrvwqvlw` … `qkkstwlr` (one New thread chip
style, AA composer hint, a seated Send, a bar-text Triage with Runs inline, an Open verb on question cards, the passive
phone meter line hidden but reachable from the thread ⋯ sheet, location chip flags in jujutsu); D 5 revisions
`ryvyyuxn` … `nqzyktsw` (`.nice()` value axes, a carded distribution table, Share by, value-first inherited effort).
Follow-ups: desktop attention rows truncate the project name at the default list width; Usage's lower sections
(Daily calendar and below) still use top rules rather than cards.

Round 14 findings, merged in `.cache/unslop-audit/r5/council/round-14-fixes.md`: one kit AttentionMeta formatter (mark,
name, kind, age; never a stubbed name; marks on a rail in list rows) for the sidebar, phone list and both Inboxes; no New
thread divider; a selected edge darker than the field edge; a 44 pt phone failed Review; child-line glyphs on Settings
child rows; a hairline on the resting send circle; a softer dark dense checkbox; small Usage and Settings touches.
All four lanes done: A kit 5 revisions `xrqzvnkv` … `ssqlwmvq` (AttentionMeta with measured drop steps and a
`keep="name"` mode, a selected edge darker than the field edge, the dark dense checkbox, DESIGN.md); B 4 revisions
`ynowuupw` … `qpozmpxp` (thread rows read through AttentionMeta on a mark rail with the verb's seat sized to the verb,
child-line glyph on Settings child rows, More font settings under its description); C 6 revisions `nvpqmvsm` …
`ovnkwvnq` (Inbox cards on AttentionMeta, a 44 pt phone failed Review, Open thread and a desktop tally, no New thread
divider, a rimmed resting send); D 2 revisions `ynkkrztu` … `owzvsmss` (provider marks in the distribution table,
Custom with a chevron). Full project names read in the sidebar, the phone list and both Inboxes.

Round 15 findings, merged in `.cache/unslop-audit/r5/council/round-15-fixes.md`: a 20 px rail seat so marks are never
clipped, the Inbox tally on the tab only, a two-line desktop Inbox head, one Inbox verb style, a reason well on failed
cards, AttentionMeta wording in the palette, a link-styled More font settings, glyphs on every group count, one overflow
glyph. The next council round seats GPT-6.2 Astra instead of Sol (owner's request), once that route is available.
All four lanes done: A kit 5 revisions `noopnqyu` … `kkvxvoyz` (a 20 px unclipped rail seat, DisclosureLink, one
OverflowGlyph, DESIGN.md); B 5 revisions `qmtxsmyw` … `mtnvwuoq` (glyphs on group counts, the 20 px glyph column, palette
attention rows on AttentionMeta, More font settings as a disclosure link, overflow glyphs); C 4 revisions `tnrxltxp` …
`xlozvqsx` (one tally, a two-line desktop head and one pill verb, a reason well on failed cards, the chat ⋯); D 3
revisions `qqxxuqzq` … `tnkmyvnr` (a bare provider mark in Where it went, overflow glyphs). The phone failed card kept
its head pill: a full-width footer Review needed ~78 px and only 16–34 px could be recovered. The lead fixed the stale
finished-turn reach.
Follow-ups: keep a failed turn's error first line on the Host so the reason well can quote it; agents and jujutsu still
draw off-size overflow glyphs; ~77 idle thread workspaces had 117 GB of turbo caches (cleared) and still hold node_modules.

Owner decision (round 16): keep the colour restraint. Colour stays on status washes, project and provider marks, nav and
group tones, tags and charts; no tinted surfaces, heroes or empty states. The GPT seat is GPT-6.2 Astra from round 16.
Round 16 findings, merged in `.cache/unslop-audit/r5/council/round-16-fixes.md`: one composer location control and lighter
starters, the answer as the strongest Inbox control with a quiet Open thread, installed plugins first, one palette row
grammar, one evidence well and a failed well only with a real error line, a Drafts count chip.
Owner decision (round 16): don't fork core's Plugins page to list installed plugins first. Core's
`@deepseek-ai/dsh-client-ui-plugin-manager` fixes the section order (`PluginManagerPage.tsx:1855-1857`) and no slot
reaches it; the route, if ever wanted, is a whole-package native fork (follow-up, not this PR).
All lanes done: A kit 2 revisions `llvmzzvk` … `svxxztxp` (EvidenceWell, DESIGN.md); B 2 revisions `zwwzrkql` …
`wltyvrml` (one palette row grammar, a Drafts count chip); C 4 revisions `mtonmzlr` … `oqkuluqv` (one composer location
chip with a jj-integration default marker, a 54 px writing area, light starters, a quiet Open thread, a 44 pt phone
Review, Inbox bodies on the evidence well, a failed well only with a real error line); D no change (Plugins order is
core's). The Settings "Open configuration file" chevron stays: it opens a real menu. Review's collapsed-line bars can't
expand (patch text only; follow-up: the Host would have to send full file contents). Trade-off: the phone failed card
starts 16 pt lower; only its title clears the tab bar, the Needs you tab's ✕ 1 still flags it.

Round 17: every deciding seat scored the round-16 set 9/10 (Opus 9, Astra 9, Claude Fable 5.2 9 in Mistral's seat at the
owner's request, after the Mistral provider failed every request including a one-line probe; GLM's review died in the same
outage). Polish the seats named for 9.5, not done: one phone top-bar seat rule across Threads and Inbox, one Inbox card body
measure, one phone action-foot grammar for failed cards, palette selection as wash plus ↵ only, a quieter phone row ⋯,
no current-thread edge on the phone list, a phone thread header meta line, the sidebar's ragged trailing column, Plugins
header buttons at 500, the unselected Inbox glyph in secondary ink, the phone transcript fade limited to 6–8 px.

## Round six: toward 10

Goal: every deciding seat (Opus, Astra, Mistral; Claude Fable stands in if Mistral's provider fails) at ≥ 9.5, or
stop after two rounds with no score increase. Owner request: a subagent's model must be easy to read wherever a subagent
appears (provider mark plus model name). First fix list: `.cache/unslop-audit/r5/council/round-17-fixes.md`.
All five lanes done: A kit 6 revisions `yttyyurm` … `yvrkpttz` (RouteModel and modelIdentity, an M/A/D/R diff badge,
nav-seat glyph ink, token fixes, DESIGN.md); B1 3 revisions `tqxulrlw` … `vyvyvskr` (one trailing edge, a quieter phone
row, a held subagent's model from its descriptor, RouteModel on the transcript row, dock, child row and header); B2 4
revisions `mvtkpryy` … `olnnvmtu` (palette wash + ↵, one phone top-bar seat rule, a phone thread meta line, the
General title mark); C 5 revisions `otlqrmor` … `knmlnoou` (one Inbox body measure, a borderless Write your own, an 8 px
phone fade, Inbox bars on the seat rule); D 6 revisions `rrzswuzq` … `nsuvmmxw` (a short Review subtitle, Plugins
buttons at 500, an HMR updates description, Auto explained once, a summarised Usage table). Restart: thread-sidebar's
Host half (its route projection is now version 2). The Mistral provider still fails; Claude Fable takes that seat.
Round 18 findings, merged in `.cache/unslop-audit/r5/council/round-18-fixes.md`: one phone Inbox card action pattern (Review in
the head on every card, so the failed card clears the tab bar), a lighter field edge still at 3:1, one quiet secondary
beside search, an aligned AI accounts effort column, a child row that gives its title the room, the composer's model
mark in its provider colour, dock and phone-list alignment, change-badge tones, and small shell, Usage and Backlog fixes.
All lanes done: A kit 7 revisions `znlzmzsv` … `yttwzxvo` (a quiet secondary, the field edge at the lightest value that
holds 3:1, toned change badges, AttentionMeta kindMark, DESIGN.md); B1 5 `nmypxvtz` … `pyxprorx` (child row without its
state word, a fixed dock action column, one phone-list grid, quiet filters); B2 6 `kplrxkos` … `pmpuqpwt` (one inactive tab
ink, the brand block on the strip, one phone canvas, the dark palette fill, quiet Settings controls, the nav keeps its
group label, the Working ring); C 6 `mxynywxx` … `zuryrxkq` (every phone single-verb card's Review in its head, the failed
card clears the tab bar by 34–41 pt, a trailing Recommended, the composer mark through the kit, one Live work seam); D 6
`tnvrwlqp` … `xvrnpyzr` (Backlog quiet View/Filter and a divider, Usage title glyph, a sparse chart height, an 8 px share
bar, an aligned effort column, Model actions). The lead added the background-jobs dock column, a Usage tab glyph through
TabPlaceGlyphs and three lint fixes. Follow-ups: a preview-tab cue that does not use ink; the folded sidebar's brand
overhang; Plugins experimental copy is core's.
Round 19 findings, merged in `.cache/unslop-audit/r5/council/round-19-fixes.md`: 12 px back under the brand hairline
(regression), the folded Inbox overhang on the strip, one phone Inbox meta grammar with a drawn 34–36 pt pill, group
chevrons on the row axis, the phone Threads search inset, one dock and composer edge, the AI accounts ⋯. If round 20 brings
no score increase, round six stops (two rounds without one).
All lanes done: B 4 revisions `soukssur` … `qnkomyxy` (12 px under the brand hairline on column and rail, the folded
overhang as the open brand row, group chevrons as the row chevron on the time edge, the phone search 8 pt under the bar);
C 3 `uyurvzlk` … `wyokynzx` (the dock's outer edge as the field edge, one phone card meta with a compact age, a 36 pt
drawn pill with a 44 pt hit); D 1 `uzsuvosn` (quiet search-side ⋯, ghost header ⋯).

Round 20: every deciding seat scored the round-19 set 9.5/10 (Opus 9.5, Astra 9.5, Claude Fable 9.5 in Mistral's seat; the
Mistral provider failed every request from round 17 on). All three pass the owner's subagent-model request. Left for a
later pass, named for 10: round dots render as superellipse squares on desktop Chrome (kit `rounded-full` needs
`corner-shape: round`), the AI accounts ⌘K hint uses a raw `<kbd>`, a roomier phone thread top bar, the palette status
mark on the title line, one phone chevron column, the Settings General title offset, the phone question card ⋯ centring,
Backlog toolbar air above its hairline, two account menus side by side, Usage's share bar beside its table, a light
palette scrim, a preview-tab cue that does not use ink. Restart when landing live: thread-sidebar's Host half (route
projection version 2), plus earlier rounds' restarts.

## Round seven: several subagents on different models

A scratch check with five children on different models found six defects: model ids with a "/" show no model on any
surface, the phone dock clips 4+ rows, a child's phone header has no model or parent link, a failed child reads
Stopped/Ready/Idle, a no-mark model name misaligns, and the transcript group miscounts. Fix list and a new multi-subagent
capture for the council: `.cache/unslop-audit/r5/council/round-21-fixes.md`. Target: every deciding seat at 9.5 on the
28-shot set plus the subagent shots, or stop after two rounds with no increase.
All lanes done: A `vrrsxnln` (RouteModel `seat`, a same-family vendor prefix dropped); B1 `xtkkyvqv` … `ulzntyzp`
(model ids with a vendor path, Failed from the Host's failed-turn record and `reason.kind`, the chat run counting a
call kept outside Worked for, the empty seat on stacked rows, Failed in the header menu); B2 `vluloywk` … `nmvoyypy`
(dock rows never shrink and the dock scrolls, a child's phone header with model, description and Back to the parent,
Turn failed there); the lead `vqxwtlzv` (desktop dock dividers). New capture: `.cache/unslop-audit/r5/capture/multi-model.mjs`
(shots 15–18). Restart when landing live: thread-sidebar's Host half (route projection version 3).
Round 22 findings, merged in `.cache/unslop-audit/r5/council/round-22-fixes.md`: two-line phone dock rows, one dock
header and card with a clean sticky edge, failed rows marked (Turn failed / Didn't start) and the failure notice named,
one count formula (`6 working · 2 failed`), the phone child names its parent, a fade under the dock, the desktop child
header state after the model, one child order, a dock model column, a merged list footer.
All lanes done, linearised into one line: F `txulxqop` … `lnwlksuy` (one count formula in the kit with a `notStarted`
part; the header chip, list and transcript group on it; failed rows with the red ✕ and Turn failed / Didn't start; a
named failure notice; no empty seat inline; no kind prefix inside the group; aligned durations; launch order; one list
footer; the desktop child header state after its model); P `xvupqvnz` … `yztpxtzr` ("{count} failed", a "Subagent of
…" strip under the phone bar, the failed count in the phone parent header, Working said once); D `lvmytlln` …
`pzkxswwl` (two-line phone dock rows, one Live work header and card with a clean sticky edge, a desktop model column, ↗
alone at rest, fades under the dock, launch order, the phone ⋯ kept in the bar row); the lead: a subagent tab named by
its description. Kept: the transcript group lists calls in call order, which can differ from launch order.
Round 23 findings, merged in `.cache/unslop-audit/r5/council/round-23-fixes.md`: live state and a model column in the
transcript group, one failed-count treatment, "Live work · 6 working" on the desktop dock, nothing cut under it, the
expanded phone dock fused to the composer with snap scrolling, child rows without an age, the failure notice naming its
model, breadcrumb sizes, clearer "1 thread working" and "1 job · 1 subagent".
All lanes done, in one line: S `ksxzqzzt` … `tkupspqp` (kit `WorkCountText` with one leading ✕ and failed ink, used on
the header chip, the sidebar parent row and the child's Turn failed; no age on child rows; one breadcrumb size; "1 thread
working"); T `vsrktxmy` … `rxusmtko` (group header on WorkCountText with no trailing glyph, live Working ring and clock
on group rows, one title column, the failure notice naming its model through a `useChildRoute` hook on chat's
run-folds contract, even notice spacing); D `uvwskmnp` … `qzzuqvso` ("Live work · N working" on the desktop dock,
nothing under its edge, the open phone dock as the composer's top section with snap scrolling, "1 job · 1 subagent").
Open: the failed child row's model still truncates ("claude-sonnet…") at the default sidebar width.
Round 24 findings, merged in `.cache/unslop-audit/r5/council/round-24-fixes.md`: the unknown model's seat and one model
and outcome column in the transcript group, "Failed" on child rows so the model reads whole, the phone dock's end and
edge fades, one selected look for child rows, one clock on the desktop child view.
All lanes done: T `smloxzzl` … `rnqknptn` (the unknown model's seat and one model and one outcome column in the transcript
group, "Failed" on child rows with the model whole, the root row's selected edge on child rows, no clock in the desktop
child header); D `uzwozxru` … `xpznqqop` (a two-row phone dock frame whose last row rests on its edge, fades only on an
edge that can still scroll, a fade under the phone top bar). The capture now opens the phone dock at its first row.
Round 25 findings, merged in `.cache/unslop-audit/r5/council/round-25-fixes.md`: the clipped phone row stacked on two
lines with its task whole, one type size per role and task names leading in transcript subagent rows, bare model ids in
AI accounts, the dock's last row height, one quiet Stop in Send's seat. If round 26 brings no increase, round seven
stops.
All lanes done: T `rwtqwuru` … `ooowvnrl` (a transcript subagent row stacks on a narrow pane and drops the kind
prefix whenever it has a task; one 13 px size for title, model and outcome; task titles in primary ink at 500); A
`tunqsqmv` (AI accounts shows the kit model name, the full id in tooltip and screen-reader text); C `klttnunn` …
`yzonlszy` (one quiet Stop in Send's seat with an empty draft, every desktop dock row 33 px, Stop and Send touch areas
apart). The capture adds 17c (the phone transcript group) and keeps rows off the phone top bar.

Round 26: every deciding seat scored the round-24 set (28 standard + 12 subagent shots) 9.5/10 (Opus, Astra, Claude Fable in
Mistral's seat; Mistral failed every request from round 17 on). Follow-ups named for 10, not done: the phone transcript row
outside the run fold ("didn't start") takes the group's primary-ink 500 title (`subagent-tool-row.tsx:215` gates it on
`runSeat.inRun`); the phone dock shows no cue that rows are hidden at rest (a 2.5-row peek or a bottom fade); a phone
thread-list shot with the seven children; the desktop child prompt bubble clamped like the phone's; the dock's columns on
the group's grid; the child order between transcript and dock; a phone dock title size. Restart when landing live:
thread-sidebar's Host half (route projection version 3).

### Round eight: colours the user chooses, from the theme

Owner request (2026-11-26): let the user pick the colour of projects, Backlog tags and configured agents from a palette,
and make that palette match the active theme (neolectron's theme system: Dracula/Alucard, gallery themes, saved
themes). Owner decisions: a theme defines a six-slot identity palette (derived from its colours when absent); a choice
stores a slot, so a theme switch recolours everything; new pickers are palette-only; projects keep upstream #287's custom
hex; the default theme's six tones are unchanged. This widens colour restraint for identity only, never state. Spec:
`.cache/unslop-audit/r5/council/round-8-palette.md`. Lanes: K (kit picker, theme palette data, derivation, application),
P (project pickers), T (Backlog tag colours), A (agent colours).

## Round four

Started 2026-11-25: a sweep of what rounds one to three did not look at closely. Three read-only audits run first, in
`.cache/unslop-audit/r4/`: every destination page against the page anatomy and its neighbours (`pages/`); states and
stress, meaning approvals, errors and recovery, reconnect, loading, first run, worst-case data, dark theme and reduced
motion (`states/`); keyboard-only use, screen-reader semantics, phone portrait and landscape, the virtual keyboard and
zoom (`access/`). Design decisions then go to a Fable 5.2 (high) consultation and taste questions to the owner; fixes
to lanes by plugin ownership.

Audits found, among others: a lost connection files real threads under "Empty drafts", whose one-click cleanup
archives them; nothing says DSH is unreachable and clocks keep counting; the Inbox says nothing needs you while 8
threads wait on approvals and failures, and five surfaces disagree about a waiting approval; a first run with no
account dead-ends on a raw error; a plugin that fails to load leaves a blank page; "All settings" closes Settings;
the thread board's "Active" contradicts the list; Backlog uses status colours as decoration; the phone search has no
way out; the header re-announces a clock every second to screen readers; under 1024 px the sidebar vanishes; the
focus ring is 2.1:1.

Decisions (Fable 5.2 high; the owner chose every recommended option): unknown is not empty (a draft needs proof it
has no turns, cleanup asks and offers Undo); one connection strip on every layout, clocks freeze while it shows, data
refetches when back; an approval is Needs you everywhere and in the Inbox, decided on its card; with no account the
composer leads with "Connect an account"; Schedules and Automations stay two pages, named by what they do; the board
uses the list's groups; Backlog in ink; a 2 px solid indigo focus ring; "Reply ready" at turn end; an "Open
sidebar" button below 1024 px. Brief: `.cache/unslop-audit/r4/round-four-brief.md`.

| Lane | Items | State |
| --- | --- | --- |
| K kit (plugin-ui, ui-styles, dshx transport errors, ratchets, DESIGN.md) | connection store, error copy and LoadError, hit areas and phone tops, focus ring, DESIGN.md | done: 7 revisions `urluryml` … `pouvwlpz`. `HostConnection`/`useHostConnection` (clocks freeze, spinners pause, queries refetch on return), `errorSentence` and `LoadError`, dshx `ApiError` carries `status` and `endpoint`, `dshx-hit-44`, phone page count hides with the h1, dark destructive 3.6 → 7.3:1, inactive tab 4.3 → 5.1:1, a 2 px solid focus ring (2.0–2.7 → 4.0–7.6:1 over 35 Tab stops), DESIGN.md R8–R15; new ratchets `faint-focus-ring` 80, `transport-failure` 0, `code-echo` 6 |
| T threads (thread-sidebar, session-controller, activity-timeline, command-palette, workbench, main-tabs) | drafts and reconnect (data safety), one approval status, Inbox approvals, failed-plugin page, Open sidebar, board, Settings row, keyboard and announcements, palette exit, tabs | done: 15 revisions `msyuxutl` … `pxpuqppw`. A failed list pull keeps the rows and retries (groups unchanged through a 15 s outage; 6 threads used to move); a draft needs a zero prompted-turn count, Clean up names the drafts, re-checks them and offers Undo; an approval is Needs you on the open thread too and in the Inbox (8 = 8, was 0 and 1 against 8), verb Review; a destination whose plugin did not load says so; an Open sidebar button below the rail breakpoint; the board uses the list's groups; All settings opens instead of toggling; the phone palette has Cancel and Esc restores focus; tab titles drop plugin prefixes and the dock strip hides on the phone shell; the header announces once per state (7 → 1); Done keeps focus in the list. thread-sidebar's Host half changed: a restart is needed. Not done: the rail as one Tab stop, ⌥J into the question card, 44 px Inbox tabs, the New tab chooser cleanup, the board's kit Page header; approvals asked before a plugin-only reload show Resolved until seeded from the Session logs; plan reviews are not in the Host log |
| S shell (settings-shell, frame-layout, shortcuts) | connection strip, status strip, shortcuts, Settings faults | done: 7 revisions `tuxskqqu` … `lvzommmr`. One connection strip (desktop pill, phone line; appears 0.1 s after a socket drop, 11 s after HTTP stops; clocks freeze), the sidebar-foot indicator gone; the fake ⌘, binding removed and ⇧⌘O listed once; Settings opens on its search, one 13 px section heading, Form | JSON under Advanced, numbers in the interface language; the status strip is a group, not a live region (3 announcements per turn → 0), its phone pill touch-sized. Not done: ⌘K on the shortcut sheet (thread-sidebar owns the listener); the chat fork's “Working for” clock keeps ticking offline |
| C conversation (chat, rich-composer, tool-meta, agent-plan, model-effort-picker, onboarding, user-questions, ai-accounts) | credential failures, first run, offline send, approval row, landscape keyboard and targets, Reply ready, full output | done: 15 revisions `srxwmzus` … `kmsomlus`, plus `ztrrxpqs` (catalog, copy baseline). A credential failure reads "No AI account can run this model. Connect an account, then send again." with Connect as its only action (no Retry, no Ask to fix); an offline send reads "Could not reach DSH. Your message is kept…" and the model chip keeps its model; a tool row waiting on approval says so with no clock, and "Rejected" after a refusal; "Reply ready" at turn end; a cut tool output offers "Open full output"; AI accounts counts every row; the landscape `@` list stays between the top bar and the keyboard; model rows and the answer field are 44 px on touch; the setup check gives up after 5 s with Retry. Not built: the owner's first-run choice (chip "Connect an account" leads, Send disabled) — the built-in provider does not tell the picker which models have a key, so the failure card leads with Connect instead; healthy quota is still green (the kit's `CreditsUsage` has no ink tone); the failing account is not opened directly |
| P pages (schedule, project-automations, backlog, jj-integration, diffs-review, jujutsu, background-jobs, agent-communication, agent-toolkit, capabilities-hub, traces, usage, secret-catalog, whiteboard, agentsview) | Schedules naming, Backlog in ink, counts, colours and controls, kit Page, Land page words | done: 14 revisions `wxrmzruq` … `zmnwxstz`. Schedules has one name and each page names the other; Automations on the kit Page with a time picker; Backlog has no red, green or amber status tone and Dropped is a struck ring; Workspaces, Processes and Messages count what their lists show; no `main..@`, `@-N` or `thread-0…` labels on the Land pages; Capabilities is one name, badges muted; trace services use identity tones; Secrets names the CLI to install; Whiteboard and Agent CLI threads on the kit Page. background-jobs' Host half changed: a restart is needed. Not done: committed screenshots for five visibly changed pages; Usage's account name; History chips for untitled threads still show folder names |

Round four pushed 2026-11-25 on upstream `687a72ad` (455 commits): CI fails exactly the jobs upstream's own run fails, for the same
reasons (two smoke scenarios, the profile-sync test, ai-accounts' `inject: ['subprocess']`, lint caps); lint is oxlint 906 against
upstream's 915, ast-grep 145 against 145. Open after round four: the first-run Send gate (no "has a key" signal from the built-in
provider), healthy quota still green, the rail as one Tab stop, ⌥J into the question card, the New tab chooser cleanup, approvals
asked before a plugin-only reload showing Resolved, plan reviews outside the Inbox, Usage's account name, agentsview's
summary cards without singular forms ("1 threads · 1 prompts"), jujutsu's reach steps stuck on the project picker's Enter.

## Round three

Started 2026-11-24 from the owner's screenshots of his live instance: one subagent drawn twice (a transcript row and a
live card above the composer, with a raw route id and one duration in two formats), bash rows spanning the full pane,
and French and English mixed in one view. Two read-only audits run first: one inventories every object drawn in more
than one place and compares the drawings; one measures friction in the daily loop (clicks, feedback latency, layout
shifts, focus, widths) on desktop and phone. Big design choices then go to a Fable 5.2 (high) consultation, and the
fixes to lanes by plugin ownership.

Audits (`.cache/unslop-audit/r3/`): the live card in the owner's screenshot is pre-branch code, but on the branch a
subagent's transcript row still reads Idle while it works, the dock flips between a card and a row, a tab says
"Finished, unread" while the list says Working, the phone dock is 2 px wide, one job is drawn in five places with four
duration formats, 12 duration formatters exist, tool rows are 742 px wide for 155 px of content, and French and
English mix (owned plugins carry only English and Chinese). Friction: the list moves under the pointer, the question
card has no keyboard path, the palette ranks commands over threads, a Settings switch waits 660 ms, the Land toast
covers the header, 12 of 19 phone targets are under 44 px.

Decisions (Fable 5.2 high; the owner chose every recommended option): a running subagent is one compact row in the
dock with a record row in the transcript; a running child makes its parent Working everywhere, a background job does
not (a muted "1 job" chip); a child is named by its task description; a job lives in the dock while it runs and in
the transcript after; one duration grammar in the kit (`9s`, `2m 05s`, `1h 04m`); work rows fit their content with
the time beside the label; English first, no new translations; no success toast after Land; the core goal strip's
words are left to upstream.

| Lane | Items | State |
| --- | --- | --- |
| K kit (plugin-ui, DESIGN.md, ratchet) | one duration module, kit defaults and motion utilities, formatter ratchet, DESIGN.md | done: 8 revisions `vyruwtqr` … `wxroonwx`; `local-duration-formatter` baselined at 12 (agent-plan 3, thread-sidebar 4, turn-summary 2, tool-meta 1, chat 1, ai-accounts 1) |
| L land and settings (jj-integration, settings-shell) | Land without toast, fresh land state, optimistic switches, Settings paints once | done: 5 revisions `wmkpmouw` … `rslvqypv`. No toast over the header after Land, focus returns to the composer; the Host watches each repository's jj operation heads and announces changes (Land appears 1.1 s after `jj describe` instead of 55 s, the "N to land" tag clears in milliseconds); switches flip in about 50 ms instead of 450–1200 ms; Settings opens with no layout shift; a note under Language. The scratch seed's stale "Session hierarchy" wait is fixed. jj-integration's Host half changed: a restart is needed. Not done: the Land page's own success toast, the plugin-enabled switch. The e2e harness's shared "Choose a project" step is stale (adding a repository now opens "Add repo") and blocks the Land journeys at the base too |
| T threads (thread-sidebar, main-tabs, workbench, command-palette, sidebar-right) | one subagent row, header roster, rolled-up status, list that holds still, reserved slots, palette ranking | done: 17 revisions `sxsyvtxk` … `tmomrqrr` plus `yrslkqtx` (catalogs). The transcript row read Idle because core answers a delegation with the child's handle, not its session id; rows now map it through the parent's catalog. Running subagents are always 32 px rows in the dock (three before folding), the transcript keeps a record row ending `Done · 48s`; tabs, header and palette read the list's rolled-up status (`thread-status-client`); the list no longer moves under the pointer (0 px, one group change after a 600 ms debounce); header, tab and status marks keep reserved seats (157/24/72 px of movement → 0); the palette ranks matching threads first; a Needs-you row shows 27 characters of its question at 280 px; a muted "1 job" chip. The popover's `1m 00s` was correct: the child's command was killed by bash's 60 s timeout. The lane's full `pnpm install` had re-hashed the lockfile (10,577 lines); replaced with the 3-line link it needed. Unverified: French, the right-pane reopen in a scratch, a real iPhone; 32 journey failures all fail at the base too |
| C transcript (chat, tool-meta, turn-summary) | rows fit content, output reachable after the fold, no turn-end shift, reply into view, durations | done: 7 revisions `vtrmxqnl` … `kymlqooz`. A bash row is 226 px instead of 742, its time 9 px from the label instead of 513; cards with a body keep the column. Each command under "Ran N commands" opens its output. Text above the reader holds still at turn end (WebKit +40 px → 0). Answering on a phone brings the reply into view (739 px below → 60 px above the composer). Transcript durations on the kit grammar (`3s`, `2m 05s`); one type size; the failure card leads with a red cross. The audit's disabled "Worked for" came from the fake provider reusing call ids, not the fold rule |
| D composer (rich-composer, user-questions, background-jobs, agent-plan) | dock width and phone floor, focus, keyboard answers, touch targets, one question row, one job home | done: 8 revisions `oqtnqxsp` … `tkxnxxvz`. Dock entries share the composer's edges (phone dock 0 → 173 px); a question is answered with a digit and Enter and focus returns to the composer; composer and question-card targets reach 44 px; one transcript row per question (`Asked · header · answer`, replacing core's row); one card per job, titled by its description, with core's header chip off behind `headerJobChip`; the composer strip no longer repeats the dock. background-jobs' Host half changed: a restart is needed. Unverified: the keyboard journey (fails at startup at the base too); a folded job is titled by its command after a reload |

Brief: `.cache/unslop-audit/r3/round-three-brief.md`.

Round three's open follow-ups: the core question row still reads "Ask question · waiting · Answer" where user-questions' row does not replace it; test-runs and finished job cards keep their own far-right durations; the Land page's own success toast; the plugin-enabled switch still disables while saving; background-jobs could publish per-thread counts so the thread list stops polling the board every 5 s; the subagent dock row is 32 px tall on touch; the core goal strip's words and 28 px buttons. Harness: the fake provider reuses call ids, `[[once]]` keys by text, `sleep 300` seeds die at bash's 60 s limit, the shared "Choose a project" step and #287's tab names break many journeys at the base.

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

CI parity (2026-11-24): the PR fails exactly the jobs upstream `main` (`ecdb9212`) fails, for upstream's own reasons
(`dshx` host-tool schema snapshot and bundle-count assertion, `repo` profile-sync test, `types` ai-accounts missing
`inject: ['subprocess']`, `lint` counts over their caps, macOS transport with no runner). A JSON comment in
jj-integration's tsconfig broke `types` and was removed; 17 lint revisions (`xzkvswlo` … `sxvzvqoz`) bring every
rule to at most upstream's count (oxlint 983 → 911 against upstream's 915; ast-grep 148 → 145, the same as upstream).

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
