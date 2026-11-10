---
name: DSH Agent Development Environment (dshfiles)
description: One product built from many plugins — a quiet, dense workbench where only what needs you has colour.
colors:
  ink: "#0f1115"
  paper: "#ffffff"
  surface-card: "#ffffff"
  surface-muted: "#f5f6f7"
  label-secondary: "#61666b"
  label-tertiary: "#81858c"
  border-hairline: "#0000001a"
  border-input: "#0000001f"
  hover-wash: "#2631480f"
  signal-blue: "#4176e6"
  danger-red: "#ec1313"
  success-green: "#22c55e"
  warn-amber: "#f59e0b"
  ink-dark: "#f9fafb"
  paper-dark: "#151517"
  surface-card-dark: "#232324"
  surface-muted-dark: "#353638"
  label-secondary-dark: "#cfd3d6"
  signal-blue-dark: "#7aaaff"
  danger-red-dark: "#f25a5a"
typography:
  page-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    lineHeight: 1.35
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  row-y: "8px"
  row-x: "12px"
  stack: "12px"
  section: "16px"
  page: "20px"
  page-narrow: "12px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "{colors.danger-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    height: "28px"
  page-tabs:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.label-secondary}"
    rounded: "{rounded.lg}"
    height: "32px"
  page-tab-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  entity-list:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
  entity-row:
    textColor: "{colors.ink}"
    padding: "8px 12px"
  entity-row-selected:
    backgroundColor: "{colors.hover-wash}"
  chip-muted:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.label-secondary}"
    rounded: "9999px"
    padding: "2px 8px"
---

# Design System: DSH Agent Development Environment

## Overview

**Creative North Star: "The Dark Cockpit"**

The ADE is an operations surface: people supervise several agents at once, glance away, and come back to "what
needs me". Like an aircraft cockpit, a healthy system is quiet. Working is colourless, finished is plain, and colour
is spent only where a human must act (Needs you) or recover (Failed). Everything else is ink on paper, dense,
legible and calm, so a single blue diamond or red cross is impossible to miss.

The product is ~80 plugins mounted into one DSH Host. Its look is borrowed from the Host theme (`--dsw-*` tokens,
light and dark) and expressed through one kit, `@dshfiles/plugin-ui` (shadcn/ui on Tailwind v4 with the `dshx:`
prefix). Plugins never bring their own chrome, palette or header style; they fill one page template. Density is
"BB density": 13px body text, 28–32px controls, 6px radius.

The plan behind this file is [docs/ade-ux/README.md](docs/ade-ux/README.md); its §3 glossary governs copy and
§4.7 the status vocabulary below.

**Key characteristics:**

- One page anatomy for every plugin page; one list row; one empty state; one tab style.
- Colour is a signal, never decoration. Category colour exists only for data (graph lanes, charts, project tones).
- Container-sized, not viewport-sized: every surface works from a 360px phone pane to a wide split.
- Sentence case everywhere; plugin names never appear in labels.

## Colors

The palette is the Host's neutral bluish greys with four state hues. Values below are the light theme; the dark theme
is selected by `body[data-ds-dark-theme]` and every semantic token switches with it.

| Role | Tailwind token | Host variable | Light | Dark |
| --- | --- | --- | --- | --- |
| Ink (text, primary fill) | `foreground`, `primary` | `--dsw-alias-label-primary`, `--dsw-alias-brand-primary` | `#0f1115` | `#f9fafb` |
| Paper (page) | `background` | `--dsw-alias-bg-base` | `#ffffff` | `#151517` |
| Card / list surface | `card` | `--dsw-alias-bg-layer-1` | `#ffffff` | `#232324` |
| Muted surface (chips, tab track) | `muted`, `secondary` | `--dsw-alias-bg-module-platform` | `#f5f6f7` | `#353638` |
| Secondary label | `muted-foreground` | `--dsw-alias-label-secondary` | `#61666b` | `#cfd3d6` |
| Hairline | `border` | `--dsw-alias-border-l2` | `#0000001a` | `#ffffff1f` |
| Hover wash | `accent` | `--dsw-alias-interactive-bg-hover` | `#2631480f` | `#ffffff14` |
| Signal blue | `info`, `ring` | `--dsw-alias-state-business-primary` | `#4176e6` | `#7aaaff` |
| Danger | `destructive` | `--dsw-alias-state-error-primary` | `#ec1313` | `#f25a5a` |
| Success | `success` | `--dsw-alias-state-success-primary` | `#22c55e` | `#22c55e` |
| Warning | `warning` | `--dsw-alias-state-warn-primary` | `#f59e0b` | `#f59e0b` |

Kit-only hues the Host lacks — `teal`, `violet`, `graph-1..6`, project tones — live in
`plugins/@dshfiles/plugin-ui/src/styles.css` with light and dark values. Use them only for categorical data.

**Rules.** Use semantic tokens only (`bg-background`, `text-muted-foreground`, `border-border`, `bg-destructive`…),
never raw hex in plugin code. Blue is never a button fill: it marks focus, selection and Needs you. Success green is
for confirmations and healthy metrics, not for "done" rows (done is muted). Warning amber is for configuration that
blocks a feature (sign-in required), not for status.

## Typography

One family, the Host's system sans (`--dsw-font-family`); code and identifiers use the Host code face
(`--ds-font-family-code`, apply with `dshx:font-mono!` on controls because the Host's unlayered form-control rule wins
otherwise). The scale is compact and steps by weight more than size:

| Role | Size / line | Weight | Use |
| --- | --- | --- | --- |
| Page title | 20px (`text-xl`) | 600, -0.01em | The page `h1`, exactly one per page |
| Section title | 13px (`text-sm`) | 600 | `PageSection` `h2`, card titles |
| Body | 13px (`text-sm`) / 1.45 | 400 | Rows, descriptions, forms |
| Label / meta | 12px (`text-xs`) / 1.35 | 400–500 | Chips, timestamps, helper text, badges |
| Code | 12px mono | 400 | Commands, paths, ids that must be read verbatim |

Descriptions cap at 72ch. Labels are sentence case; ALL-CAPS form labels are retired. Numbers in counters and tables
use `tabular-nums`.

## Layout

**Page anatomy** (`Page` from `@dshfiles/plugin-ui/components/page`):

```
┌ Page (its own @container; padding 20px, 12px below 28rem) ───────────────────────────┐
│ h1 Heading  12  [meta chip] [meta chip]          [Secondary] [Secondary] [⋯] [Primary] │
│ One-line description, muted, ≤ 72ch                                                    │
│ [ Tab · Tab · Tab ]   ← optional, one segmented style                                  │
│ ─ body: PageSection (h2 · meta · actions) → EntityList / form / table / EmptyState ─   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- At most one primary action. Secondary actions are outline buttons while the page is at least 42rem wide and fold
  into the `⋯` overflow menu below that; the primary never folds.
- Pages fill their pane (no centred max-width column). Body stacks use 12px gaps; sections 16px.
- Size by container, never by viewport: the page root is `@container`; children query `@max-pane-narrow` (< 28rem,
  phones and 360–480px panes) and `@max-pane-compact` (< 42rem, split layouts). Collapse order: labels become icons,
  secondary chips hide or wrap, primary text truncates, and only then does a row wrap.
- No horizontal page overflow at 390px. Filter rows scroll sideways (`overflow-x-auto`) instead of wrapping into a
  column of chips.

## Elevation & Depth

Flat, tonal layering. Surfaces separate by hairline borders (`border-border`) and the muted surface, not by shadow.
Shadows are reserved for floating layers: popovers and menus (`shadow-md`), the sticky batch-action bar
(`shadow-lg`), dialogs. Declare depth once — a bordered card has no shadow. Stacking bands: Host modals 1000, kit
dialogs/sheets 1050, floating layers (select, popover, menu, tooltip) 1100.

## Shapes

Radius scale 4 / 6 / 8 / 12px. Controls and rows are 6px (`rounded-md`); lists, cards and the tab track 8px
(`rounded-lg`); dialogs 12px. Badges and chips are full pills. Borders are 1px hairlines; no coloured side borders.

## Components

**Primary button — black.** `Button` `variant="default"` is the Host brand fill (`#0f1115` light, `#f9fafb` dark),
which most pages already used (MCP Add server, Memory, Backlog New, Hosts). One per page. Header secondary actions are
`outline` `sm`; row verbs are `outline` or `ghost` `sm`; destructive verbs `destructive` and always behind a
confirmation when they lose work.

**Tabs — one style.** The segmented `TabsList` (muted track, paper active pill) for page views, rendered by `Page`
`tabs`. A filter over one list (Running / Finished / All) is a `ToggleGroup`, which looks the same. No underline tabs
on pages.

**EmptyState.** One sentence, centred, muted, at most one outline action. It never draws its own frame; the list or
card it sits in does. Loading is a `Spinner`, not an empty state.

**Status vocabulary** (`WorkStatus`, `StatusGlyph` from `components/work-status`). Exactly six states for every work
item — thread, subagent, job, check, workspace, host. Plugins map onto them and add detail text, never colours.

| State | Meaning | Glyph | Row title |
| --- | --- | --- | --- |
| Working | progressing without you | spinner, no colour | normal |
| Needs you | cannot continue without you | blue filled diamond | normal |
| Failed | broke, with a recovery verb | red cross | normal |
| Ready | finished, not yet seen or landed | solid ink dot | **bold** |
| Idle | seen, nothing pending | none (empty 16px box) | normal |
| Done | landed or closed; workspace released | muted check | muted |

**EntityRow / EntityList** (`components/entity-row`). One row shape: `leading control · status glyph · title · muted
meta chips · trailing inline verb`, with an optional muted description line and full-width children (an output pane).
The middle is one button when the row selects; leading and trailing stay separate controls. Lists are one bordered
card with hairline dividers. In narrow panes meta wraps under the title and trailing verbs drop to their own line.

**PageSection.** `h2` (section title) that names its `section` region, optional muted meta ("3 enabled") and actions.

## Do's and Don'ts

- **Do** build every page from `Page` → `PageSection` → `EntityList`/form/table → `EmptyState`.
- **Do** map plugin states onto the six `WorkStatus` values; put nuance in the detail text.
- **Do** use the glossary: thread, project, workspace, host, land, done, agent, Needs you, usage, memory
  ([plan §3](docs/ade-ux/README.md#glossary-enforced-in-copy)). `node --run check:copy` ratchets banned terms.
- **Don't** colour working or healthy states; don't add a second attention colour.
- **Don't** put plugin names in labels ("pulls.review: Reviews", "Thread Sidebar: Navigation").
- **Don't** use a blue primary button, an icon-tile header, underline page tabs or ALL-CAPS labels.
- **Don't** centre a page in a max-width column or size a pane with viewport breakpoints (`sm:`/`md:`).
- **Don't** leak raw ids or absolute paths into labels; show the entity's name and keep the id in a tooltip.
