# PR #258 "quiet workbench redesign" — design language for onboarding

Sources: PR body (gh), commits `db5dd547` `72e36cbd` `9c72bd629372` (redesign) `24fe493f` `3dfdd62d` `4e4a7bbc` `059abb00` `aecc71e7`,
`DESIGN.md` (unchanged since `9c72bd629372`; `jj diff --from 9c72 --to @ DESIGN.md` empty), `docs/ade-ux/` (plan + research),
screenshots viewed: onboarding getting-started / setup-wizard / show-me-where, workbench conversation-header,
shortcuts cheat-sheet, thread-sidebar phone-tab-bar, chat since-you-left. Repo: `~/dev/dshfiles-threads/freeze-fix`.

## a. Principles

1. **North star "The Dark Cockpit"** (DESIGN.md Overview). A healthy system is quiet: working = colourless, finished =
   plain, colour only where a human must act (**Needs you**, indigo) or recover (**Failed**, red). Everything else is
   ink on warm paper. PR rationale: plugins "read as many small apps"; goal is _one_ design language + _one_ way to
   work through threads (triage → review → land).
2. **One kit, one page template.** Plugins never bring chrome/palette/header; they fill `Page` from
   `@dshfiles/plugin-ui` (shadcn/ui on Tailwind v4, `dshx:` prefix). "One page anatomy, one list row, one empty
   state, one tab style."
3. **Density ("BB density").** 13px body, 28–32px controls, 6px radius. Two densities switched by pointer/width,
   never UA: compact desktop (`--dshx-density-text-ui` 13, `-prose` 14, `-meta` 12, `-min` 11, `-target` 28px) vs
   comfortable coarse pointer (15/15/13/12, input 16px, target 44px). Safe areas `--dshx-safe-*`.
4. **Hierarchy by weight, not size.** Type scale (Geist / Geist Mono, vendored in `ui-styles/src/fonts`):
   Display 26/32 `text-display` 600 −0.02em (only the new-thread hero) · Page title 20/28 `text-title` 600 −0.01em
   (exactly one h1) · Section title 13 `text-sm` 600 (`PageSection` h2) · Body 13 `text-sm`/1.45 · Prose 14
   `text-base` · Label/meta 12 `text-xs` · Dense meta 11 (12 phone) `text-2xs` · Code 12–12.5 mono. Min 11px.
   Descriptions ≤72ch. Sentence case. `tabular-nums` for counters/times. Font only via `font-sans`/`font-mono`.
5. **Colour = generated tokens.** `palette({hue,chroma,accentHue,contrast,scheme})` in
   `plugin-ui/src/theme/palette.ts` → 11 neutral steps oklch warm stone (bg, panel, raised, selected, line, border,
   border-strong, strong, faint, muted, text) + indigo accent + status trios; emitted by `scripts/emit-theme-css.ts`
   into `ui-styles/src/theme.generated.css` (never edit). Semantic Tailwind tokens only: `bg-background`, `bg-card`,
   `bg-muted`/`secondary`, `border-border`, `border-input`, `text-foreground`, `text-muted-foreground`, `info`/`ring`
   (indigo), `destructive`, `success`, `warning`. Raw: `--dshx-tone-<step|name>`. Status = **trio** (colour,
   `-bg` 12%, `-border` 30%), never a solid fill. Hover/pressed = ink at 6–14% alpha. Presets (Warm stone default,
   Neutral, High contrast, Slate blue, Moss) in `plugin-ui/src/theme/appearance.ts`; write CSS against tokens, never
   assume stone/indigo. Light default; dark equally finished (`body[data-ds-dark-theme]`). AA enforced by
   `plugin-ui/tests/palette.test.ts`. Category hues (`teal`, `violet`, `graph-1..6`) only for data.
6. **Spacing.** row 8×12px, stack 12px, section 16px, page 20px (12px below 28rem). Pages fill the pane — no
   centred max-width column.
7. **Shape/elevation.** Radii 4 chips · 6 controls/rows · 8 cards/code · 12 composer/menus/dialogs · 16 phone sheets
   (`rounded-sm|md|lg|xl|2xl`); chips/badges full pill; 1px hairlines; no coloured side borders. Heights
   `h-control-compact` 24 · `h-control` 28 · `h-row` 32 · `h-bar` 36 · `h-touch` 44. Flat tonal layering:
   `shadow-s0` rest, `s1` composer/sticky bars only, `s2` menus/popovers, `s3` dialogs/sheets; a bordered card has no
   shadow; blur only s2/s3. z: Host modals 1000, kit dialogs/sheets 1050, floating 1100.
8. **Motion.** `--dshx-duration-*`: 80 hover/press · 120 collapse/fade · 160 menus · 220 panels · 280 phone sheets;
   enter `cubic-bezier(0.2,0,0,1)`, exit 100ms `cubic-bezier(0.4,0,1,1)`. Working = 2.2s shimmer / phase-synced ring,
   paused off-screen (`useOffscreenPause`). Reduced motion → opacity only. `@dshfiles/plugin-ui/motion` presets.
9. **Keyboard-first.** Shortcut sheet `?` / ⌘/ (shortcuts plugin, `cheat-sheet.tsx`) with grouped rows
   (Global, Go to, Lists…) and `Kbd` keycaps; **single-key layers** (`G T` go to Threads, `G I` Inbox, `J/K` lists,
   `⌥J` jump to next waiting) that never fire while typing and can be switched off (chords always on). Inbox keyboard
   triage (`activity-timeline/src/triage-machine.ts`: one item at a time, Needs you first then Ready, frozen queue,
   until Inbox zero; verbs Answer/Approve/Retry/Resume/Land, Skip, Snooze). Peeks (`PeekCard`/`RowPeek`, Space; `1`–`9`
   answer in place). `/` focuses search, Escape clears. Every command is in ⌘K palette (`PaletteActions`).
10. **One layout.** Sidebar = rail destinations (Threads, Inbox, Land, Work, Agents, Observe, Knowledge) + panels
    (user folders via `sidebarTree`) + DSH actions on rail (`thread-sidebar/src/sidebar-shell.tsx`). Phone: bottom
    tab bar (Threads, Inbox, Land, More), stack nav with edge-swipe back, swipe/long-press rows
    (`useRowGestures`, 72px commit, 500ms long press), 44px targets, sheets instead of panes/dialogs.
    Container-sized: `@container` page root, `@max-pane-narrow` (<28rem) and `@max-pane-compact` (<42rem); never
    `sm:`/`md:`.
11. **Fixed surfaces don't grow.** Composer bar = `+ · mode · ⋯ · model · send` + one meta line; thread header = one
    row + one `⋯`; reply row = copy + `⋯`. New verbs go into the matching `⋯` menu/registry or show only while they
    carry live state (a count). Never draw a second control for something that has one — feed the existing control.
12. **Every opinion has a setting** (PR table): theme, view mode, `showComposerExtras` (off), `showAgentPresetPicker`
    (off → chip shown only when non-default), single-key shortcuts, `showRailActions`, filter presets, `sidebarTree`,
    `showMainTabs`, `showResetTimes`, `autoRestartWhenIdle` (off). Agent parity: `theme_get/set`,
    `transcript_view_set`.

## b. Components/patterns for an onboarding UI

All in `plugins/@dshfiles/plugin-ui/src/` (import as `@dshfiles/plugin-ui/...`):

1. `components/page.tsx` — `Page` (title, description, meta chips, ≤1 primary action, secondaries fold into `⋯` below
   42rem, `tabs`), `PageSection` (h2 + meta "3 of 4" + actions), `EmptyState` (one sentence, ≤1 outline action, no frame).
2. `components/entity-row.tsx` — `EntityList` (one bordered card, hairline dividers) + `EntityRow`
   (`leading · glyph · title · meta chips · trailing verb`, optional description line). Checklist rows use this.
3. `components/work-status.tsx` — `StatusGlyph`, `WorkStatus` (working, needs-you, failed, ready, idle, done; glyph-only
   stale, stopped). Map checklist states onto these; never new colours.
4. `components/peek.tsx` — `PeekCard`/`RowPeek` popover preview with `KeyHint`.
5. `components/ui/*` — `button` (default = ink/black primary; `outline`/`ghost` sm), `dialog`, `sheet` (phone),
   `toggle-group` (filters), `tabs` (segmented only), `badge`, `kbd` (`Kbd`, `KbdGroup`, `KeyHint`), `input-group`,
   `search-input`, `switch`, `tooltip`, `dropdown-menu`, `progress`, `skeleton`, `spinner`, `empty`.
6. `components/motion/step-trail.tsx` (`StepTrail`: done/active/pending/gated steps) and
   `components/motion/toolbar-walkthrough.tsx` (`ToolbarWalkthrough`: steps over tools, next/close) — ready-made
   stepper/walkthrough primitives.
7. `hooks/row-gestures.ts` (`useRowGestures`), `hooks/offscreen-pause.ts`, `icons` (lucide is the one family).
8. Existing onboarding plugin to build on, not duplicate: `plugins/@dshfiles/onboarding/src/` —
   `getting-started-page.tsx` (Page → PageSection Setup checklist / Packs / Features / What's new, uses EntityRow,
   StatusGlyph, ToggleGroup, InputGroup search), `setup-wizard.tsx` (Dialog desktop / Sheet phone, "Step 1 of 3",
   Account → Project → First task, Back/Next/Don't show again), `first-run.ts` (`FirstRun.setup`: opens only while
   account/project/repository missing; 3s wait; failed read → open), `show-me-where.tsx` (portal coach-mark: small
   bottom-right card "Step 1 of 3 · Click 'Account menu'", Next/End), `try-it-dialog.tsx`, `whats-new-section.tsx`,
   `suggestions-section.tsx`, `wizard-store.ts`, `labels.ts`. Also `settings-shell/src/native/welcome-notice.tsx`
   (versioned acknowledgement) and `rich-composer/src/native/skeleton/EmptyHero.tsx` (empty-thread hero; e2e
   `workbench-welcome.feature`).
9. Entry points pattern (`docs/ade-ux/migration-map.md`): rail Knowledge › Getting started; palette "Getting started",
   "Show the setup wizard"; empty thread view (first run).

## c. Do / Don't

Do:

1. Build Page → PageSection → EntityList/form → EmptyState; one h1, one primary (black) action.
2. Use semantic tokens and scale utilities only; status trios for tinted states.
3. Map progress onto the six `WorkStatus` states; nuance goes in detail text.
4. Use the glossary (thread, project, workspace, host, land, done, agent, Needs you, usage, memory); `node --run check:copy`.
5. Sentence case, ≤72ch descriptions, `tabular-nums` counts ("3 of 4").
6. Size by container; Dialog → Sheet on phone; 44px touch; filter rows scroll sideways at 390px.
7. Give every opinionated behaviour a setting + agent tool parity; keep keyboard paths (Esc, Next, `/`).
8. Never block the app; never send a prompt without confirmation (Insert prompt ≠ send; Try it confirms tokens).

Don't:

1. Colour working/healthy states; add a second attention colour; use indigo as a button fill or decoration.
2. Raw hex/rgb/oklch, `text-[Npx]`, `rounded-[…]`, native `Icon…OutlineRegular` icons — ratcheted by
   `scripts/design-token-check.ts` (`node --run check:design-tokens`, baseline `scripts/design-token-check.baseline.json`).
3. Icon-tile headers, underline page tabs, ALL-CAPS labels, plugin names in labels, raw ids/paths in labels.
4. Centred max-width page columns or viewport breakpoints.
5. Add controls to fixed surfaces (composer bar, thread header, reply row); add a second control for an existing one.
6. Shadows on bordered cards; coloured side borders; spinners for working rows (use shimmer/ring).
7. Taglines/helper chrome: an EmptyState is one sentence.

## d. Hints of progressive disclosure / zen / first-run

1. **Progressive disclosure is an explicit rule** (`docs/ade-ux/research/prior-art.md` §1.5, §4, §6): two levels
   max, first-level rail entries chosen from usage data, everything else via More or ⌘K palette, no third level.
2. Composer extras hidden by default in `⋯` (`showComposerExtras` off); mode chip shown only when non-default
   (`showAgentPresetPicker` off); Try it and Suggestions off by default; at most one new suggestion per day ("Quiet").
3. **Focus/zen-adjacent**: transcript view modes Summary / Normal / Verbose (`transcript_view_set`), folded tool
   runs/jobs/subagents into one row, `showMainTabs` off / "⌘K Layout: hide tabs", sidebar toggle ⌘B, panel
   fullscreen ⌥⌘Enter, triage mode (one item at a time until Inbox zero). Research notes Kiro "Agent Focus Mode"
   (sessions · chat · aux panel hidden until needed) as prior art (`docs/ade-ux/research/competitors-c.md` §7).
   No dedicated "zen mode" exists.
4. **Return/re-entry**: "Since you left" recap card (chat), What's new with Mark as seen, `welcome-notice` versioned ack.
5. **First run**: `FirstRun` opens the wizard only while setup is missing and no thread is open (fork default: an
   existing user in a new browser never sees it); Escape defers, Done / Don't show again persist per browser;
   replayable via ⌘K "Show the setup wizard" or Start setup. Empty thread keeps native centered welcome
   (`EmptyHero`, `text-display`) until first message. Show me where = step-by-step coach mark replaying a
   feature's `reach` steps.
