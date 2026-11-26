# @dshfiles/plugin-ui

shadcn/ui for dshfiles DSH plugins, plus TanStack Query, Table, Form, Machine, Chart, Diff, and Virtual bindings. This package guide is the current source of truth for components and integration; [state ownership](docs/state-ownership.md) covers the async-data, form, flow, and persistence boundaries.

- **Tailwind v4, `dshx:` prefix, no global Preflight** — the dshx client-CSS contract. A scoped Preflight applies under `.dshx-root` and inside shadcn portal content (`[data-slot$="-content"]`); never bare `[data-slot]`, which DSH also uses for its own outlets.
- **shadcn semantic colors are the DSH theme.** `src/styles.css` maps `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `info`, `success`, `warning`, `chart-1..5` inline onto `--dsw-*`, so light/dark follow the Host. `teal` and `violet` are categorical hues the Host theme lacks (workspace and divergence chips), and `graph-1..6` are the revision graph's branch hues; each has its own light and dark value. `dark:` matches `body[data-ds-dark-theme]`.
- **BB density.** `text-sm` is 13px, controls are 32px (`sm` 28px, `xs` 24px), radius 6px.

## Wire a plugin

```ts
// dshx.config.ts
import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
export default defineConfig({ client: { entry: 'src/client.tsx', vite: { plugins: [pluginUiVite()] } } })
```

A consumer needs no stylesheet of its own: `@dshfiles/ui-styles` is the one bundle that imports this package's
`styles.css`, compiles the union of every owned plugin's classes and injects the sheet once. A plugin that needs extra
rules of its own keeps a `src/client.css` holding only those rules — imported once from the client entry, never
importing the shared sheet again — as `jujutsu` and `memory` do. Depend on `"@dshfiles/plugin-ui": "link:../plugin-ui"`.
Do not add Tailwind, Radix, or TanStack packages to a plugin directly — this package pins them.

## Use

```tsx
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

;<section className="dshx-root dshx:flex dshx:flex-col dshx:gap-4 dshx:p-6">
  <Button variant="outline" size="sm">
    <RefreshCwIcon /> Refresh
  </Button>
  <Badge variant="secondary">6 secrets</Badge>
</section>
```

- Put `dshx-root` on each surface root you render. Prefix every utility (`dshx:hover:bg-accent`), write complete static class strings, merge with `cn`.
- Animated components: `src/components/motion/` on the shared motion layer (see [Motion](#motion)).
- Components: `src/components/ui/` (button, input, textarea, label, select, checkbox, switch, tabs, badge, card, table, dialog, alert-dialog, dropdown-menu, context-menu, popover, tooltip, command, combobox, separator, skeleton, toggle, toggle-group, collapsible (with `DisclosureTrigger`), alert, kbd, spinner, empty, field, input-group, item, progress, scroll-area, page-header, search-input, status-dot, project-mark, attention-badge, place-glyph). Wrap tooltips in `TooltipProvider`.
- `PageHeader` (`components/ui/page-header`) is a plugin page's top row: `heading` (the `h1`) over a one-line `description`, with badges and actions as children on the right.
- `SearchInput` (`components/ui/search-input`) is the search field: the input group with a leading search glyph. `className` sizes the group; `aria-label`, `value`, `ref` and every other prop reach the input.
- `StatusDot` (`components/ui/status-dot`) is the round status marker: `tone` (`current`, `success`, `destructive`, `warning`, `info`, `muted`) or a computed color class, `size` `sm` (6px) or default (8px). It is `aria-hidden` unless given an `aria-label`, which makes it `role="img"`; it forwards its ref so a `TooltipTrigger asChild` can wrap it.
- `ProjectMark` (`components/ui/project-mark`) is a project's identity tile: the project tone at 14% behind two letters (first letters of the first two words, else the first two letters; `projectMarkLetters`). Props: `name`, `tone` (0–5, the owner's choice; without it the name hashes to one, `projectToneIndex`), `color` (a custom `#rrggbb`, wins over `tone`), `palette` (`balanced` default, or `cool`), `size` (`default` 20px, `dense` 16px; the tile widens instead of clipping) and `decorative` (default `true`, `aria-hidden`; `false` makes it an image named after the project). Put the project name beside it in muted text. The six tones (`--dshx-project-balanced-0..5`, `project-tone-balanced-<n>`) keep 25° away from every status hue.
- `PlaceGlyph` (`components/ui/place-glyph`) is a place's glyph seat, the selected-place tile: the glyph in its place's tone and, while the place is selected, a 14% tile of that tone behind it. Props: `tone` (a `PlaceTone`: `threads`, `inbox`, `land`, `work`, `agents`, `observe`, `knowledge`, `settings`), `toneColor` (any CSS colour, such as a Settings group's `var(--dshx-identity-7)`; wins over `tone`), `selected` (`true`/`false`; left out, the tile follows the surrounding row or tab's `aria-current`, `aria-selected="true"` or Dockview's `.dv-active-tab`) and `size` (`default` a 24px seat for a 16px glyph, `lg` 28px for 18px). Without React: `dshx:place-seat` plus your own size and radius on the seat, `PLACE_TONE_CLASS[tone]` or `placeToneStyle(colour)` for the tone. The wash, marker and label of the selected row stay neutral ink.
- `components/image-lightbox` (`ImageLightbox`) is the one full-window image viewer: arrow keys and side controls move, the thumbnail strip jumps, Escape closes and focus returns to the opener, and an image without `src` shows as loading. The thread composer and the backlog composer both render it, so a gallery change lands in one place. Labels default to English and accept a translated `ImageLightboxLabels`.
- Agent cards: `components/tool-card` (`ToolCard` on the Host `DisclosureRow`, `StatusIcon`), `components/code-block` and `components/stack-trace` (see [Code and stack traces](#code-and-stack-traces)). The Host `TerminalBlock` stays the view for command output.
- `Markdown` (`components/markdown`) renders text through the Host `MarkdownText` with English chrome and the `compact` variant by default; `[label](scheme:target)` links open through the dshx `LinkHandler` registry. `Code` (`components/code`) is the Host `CodeBlock` with English copy labels. Pass translated `labels`/`copyLabel` when the plugin has a locale.
- Icons: `import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'` (lucide-react re-exported, so plugins need no extra dependency); Host `Icon*` from `@deepseek-ai/dsh-client-ui-primitives` where a DSH-native glyph matters.
- Readable names: `EntityLabels` (`@dshfiles/plugin-ui/hooks/entity-labels`) turns Session ids into thread titles (`useSessionLabel`) and workspace ids or folders into project names (`useWorkspaceLabel`); `isThreadWorkspace` and `groupByRepository` fold jj thread workspaces under their repository. Pass the optional `threadDirectories` (from `@dshfiles/thread-sidebar/thread-directories` or a Host answer) so a custom threads directory folds too; without it the `<repository>-threads` layout applies. Pass it the injected `ctx.sessions` / `ctx.workspaces`.
- Per-thread polls: `useSessionOnScreen` (`@dshfiles/plugin-ui/hooks/session-on-screen`) says whether the main view shows a thread. Main tabs keep every visited thread mounted, so gate a per-thread `refetchInterval` on it and keep the first read on mount.
- Copy feedback: `useCopyFeedback` (`@dshfiles/plugin-ui/hooks/copy-feedback`) copies through the Host `writeClipboard` and returns `copied` for 1.5 s after a successful write, for a copy button that swaps its glyph or label. `copy` resolves to whether the write succeeded, so a caller can still report a failure.
- Hand-rolled dialogs: prefer the kit Dialog, Sheet or Popover. When the surface cannot use them (it stays mounted while hidden, or anchors to a Host slot), `useDialogFocus` (`@dshfiles/plugin-ui/hooks/dialog-focus`) moves focus in on open (`initialFocus` or the first focusable), keeps Tab inside with `trap`, and returns focus to the opener on close. Escape and `aria-modal` stay with the surface.
- Phone bottom sheets drag: `installSheetDrag` (`@dshfiles/plugin-ui/hooks/sheet-drag`, installed once by `@dshfiles/ui-styles`) moves every phone sheet that draws the grabber (kit menus, selects, popovers, the Host menu, composer pickers) and any element marked `data-dshx-sheet`. The grab strip or a `data-dshx-sheet-handle` drags either way; the content drags down only from its scroll top. It snaps to rest, expanded (up to 90% of the viewport when the content overflows) or dismissed (`SheetSnap` in `lib/sheet-snap`), honours flicks and `prefers-reduced-motion`, and dismisses through Escape, so an owner only needs its usual Escape close. Touch on a phone-width viewport only.
- List selection: `ListSelectionModel` (`@dshfiles/plugin-ui/hooks/list-selection`) is the shared anchored selection for batch lists — `toggle`, `extend` (inclusive Shift range from the anchor), `toggleAllVisible` (visible-only select-all), and `prune` (drop ids a filter, group or scope hid). Keep selection in `useState<ListSelection<Id>>`; the batch bar and any confirmation belong to the list, not the model.
- Infinite lists: `useLoadMore` (`@dshfiles/plugin-ui/hooks/use-load-more`) observes a sentinel near a scroll boundary and re-arms when its `resetKey` changes, so short lists keep filling until the sentinel leaves the root. Change the key after content grows, disable the hook while a page is pending, and keep its callback fresh through a ref. Keep older-page sentinels before all rows; `usePrependScrollAnchor` (`@dshfiles/plugin-ui/hooks/use-prepend-scroll-anchor`) preserves the visible position when older rows prepend.
- Small views: `dshx:@container` on a surface root, then `dshx:@max-pane-narrow:` (< 28rem) and `dshx:@max-pane-compact:` (< 42rem) on its children. Panels follow their own width, not the viewport; the collapse-order rules are in the `plugin-ui` skill.

### Adding a registry component

```sh
cd plugins/@dshfiles/plugin-ui
pnpm dlx shadcn@4.21.4 add <name-or-registry-url>
```

`components.json` sets the `dshx` prefix and self-referencing aliases. After adding, rewrite `@dshfiles/plugin-ui/...` and `cn` imports in the new file to relative `.js` paths (`../../lib/utils.js`, `./button.js`, so NodeNext consumers typecheck) — the CLI resolves them inconsistently — check it did not add stray dependencies, and use `React.forwardRef` on any part a Radix `asChild` trigger wraps (React 18 drops `ref` on function components).

## Page kit

Every plugin page (main panel, stage detail) is built from one template, so the product reads as one app
([ADE plan §5](../../../docs/ade-ux/README.md#5-the-plugin-presentation-contract); tokens and anatomy in
[DESIGN.md](../../../DESIGN.md)). Pilots: activity-timeline, background-jobs, mcp-servers.

```tsx
import { EmptyState, Page, PageSection } from '@dshfiles/plugin-ui/components/page'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { StatusGlyph, type WorkStatus } from '@dshfiles/plugin-ui/components/work-status'

;<Page
  heading="Hosts"
  description="Machines threads can run on."
  count={hosts.length}
  primaryAction={{ id: 'add', label: 'Add host', icon: <PlusIcon />, onSelect: openAdd }}
  actions={[{ id: 'refresh', label: 'Refresh', icon: <RefreshCwIcon />, onSelect: refetch, pending: isFetching }]}
>
  <PageSection heading="Registered" meta={`${online} online`}>
    {hosts.length === 0 ? (
      <EmptyState action={{ label: 'Add host', onSelect: openAdd }}>No hosts yet.</EmptyState>
    ) : (
      <EntityList>
        {hosts.map(host => (
          <EntityRow
            key={host.id}
            role="listitem"
            status={toWorkStatus(host)}
            heading={host.name}
            meta={<span>{host.os}</span>}
            trailing={
              <Button size="sm" variant="outline">
                Connect
              </Button>
            }
          />
        ))}
      </EntityList>
    )}
  </PageSection>
</Page>
```

| Part                       | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Page`                     | One `h1` `heading` (22px/650, `text-title font-title`), optional description (≤ 72ch), optional `count` (tertiary ink) or `statusCounts` (one `StatusCount` per status present, attention first) and `meta` chips (two or three), **at most one** `primaryAction` (give it `items` to make it a `New ▾` menu of kinds), any number of `actions`, optional `tabs`, then the body. It is its own `@container` with `p-6` (`p-3` below 28rem). Header and body share one start-aligned container capped by `width`, one of two frames: `lane` 880px of content, 960px on a pane of 1280px or more (the cap is the content box, `box-content`, with the padding outside; lists), `form` 720px of content on the same inset rules (label/control rows: Settings' header, toolbar and rows) or `wide` min(100%, 1200px) (data pages); `full` (a diff, chart or table; the default with `fill`) and the legacy `page` 1080px (default) remain. The header actions sit on the frame's trailing edge. A page that owns its layout uses the standalone `PageHeader` (`components/ui/page-header`) inside its own box with `PAGE_FRAME_CLASS.lane` / `PAGE_FRAME_CLASS.form` / `PAGE_FRAME_CLASS.wide` and `dshx:p-6`. Below 42rem (measured with a `ResizeObserver`) inline `actions` fold into the `⋯` overflow menu; `placement: 'overflow'` keeps one there always. `scroll` makes the page own its scroll (`h-full overflow-y-auto`) where the host pane does not; `fill` instead fills the pane height and hands the rest to the body (or active tab), for master–detail pages whose panes scroll on their own. |
| Page title mark            | `mark` (the destination's lucide glyph) and `markTone` (a `NavToneId`: threads, inbox, land, work, agents, observe, knowledge, settings) on `Page` and `PageHeader` draw one 18px glyph before the `h1`, 8px from it, centred on the title's first line, in `text-nav-<id>` (secondary ink without a tone). A glyph, never a tile or a tinted header; `aria-hidden`, the `h1` names the page. `PageTitleMark`, `NAV_TONE_IDS` and `NAV_TONE_TEXT_CLASS` come from `components/page`. Destination pages only (`<Page heading="Usage" mark={<ChartColumnIcon />} markTone="observe">`). |
| Page tabs                  | Underline tabs for page sections (`tabs.variant="underline"`: ink labels on a hairline, a 2px ink bar under the active one); the segmented `TabsList` (grey track, paper pill) only for up to four view modes of one list, which is the default up to four items. Past four items the tabs are always underline. A filter over one list stays a `ToggleGroup`. Both scroll sideways when they do not fit. |
| `PageSection`              | A `section` named by its `h2` `heading` (`text-sm font-semibold`), optional muted `meta` ("3 enabled"), `actions` and description.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `EmptyState`               | One sentence, centred and muted, plus at most one outline action. It draws no frame: the list or card around it does. Not for loading (use `Spinner`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `WorkStatus`               | Exactly six states (`working`, `needs-you`, `failed`, `ready`, `idle`, `done`, ADE plan §4.7). Map plugin states onto them; add detail text, never a new colour. `WorkStatusModel` has the labels and the attention/emphasis predicates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `StatusGlyph`              | Fixed 16px box (`size="small"`: a 10px seat for `StatusCount`). Dark cockpit: working is a colourless ring spinner (all spinners phase-synced, paused off screen), needs-you the `info` diamond, failed the `destructive` cross, ready a 10px green dot (`text-status-ready-mark`, lighter than the ready text in light), idle a faint 10px ring, done a muted check; glyph-only `stale` (dashed ring) and `stopped` (muted square). Labelled by default; `decorative` when the row already states it in text.                                                                                                                                                                                                                                                                                                                |
| `EntityRow` / `EntityList` | `leading` (checkbox, chevron) · glyph · `heading` · muted `meta` chips · `description` line · `trailing` inline verb; `children` render full width below (an output pane). `onSelect` makes the middle one button; `leading`/`trailing` stay separate controls. Ready titles are bold, done titles muted, nothing else is coloured. In narrow panes meta wraps under the title and trailing verbs drop to their own line. `EntityList` is the one bordered list with hairline dividers; give its rows `role="listitem"`.                                                                                                                                                                                      |

**Primary button: ink.** The primary action is `Button` `variant="default"`, which is `bg-primary` = the Host
`--dsw-alias-brand-primary`: the ink in light, and in dark a softened warm grey (`--dshx-primary-fill`,
`oklch(0.88 0.006 65)`) so it is not the brightest thing on the screen; its label is the page colour, AA at rest and on
hover (`tests/primary-fill.test.ts`). Native primary buttons read the same alias. Blue (`info`, `--dsw-alias-state-business-primary`) is never a button fill: it is
reserved for focus rings, the active tab bar, a control's on state and the Needs-you glyph. One primary per page; everything else is `outline`
(header) or `ghost`/`outline` `sm` (rows).

**Row attention verbs: the tint rung.** A row-level verb that answers what waits on you (Review, Answer, Rate…) is
`variant="attention"`: Needs-you text (`text-attention-foreground`) on a 12% tint of it (18% hover, 24% pressed), no
border. A failed row's recovery verb is `variant="danger-tint"` (`text-danger-tint-foreground` on the danger tint). The
text is the status colour pulled 30% toward the ink, so it holds AA on its own tint over every surface. A chip or a band
that is not a button uses the same pair: `bg-attention-tint text-attention-foreground`, `bg-danger-tint
text-danger-tint-foreground`. Neither is a page primary: that stays the one ink button.

On a row that already carries an attention wash (a Needs-you or Failed thread row), the verb is the text rung,
`variant="attention-text"` or `variant="danger-text"`: the same foreground on a transparent fill, the 12% tint only on
hover and 18% pressed, so the row shows one layer of colour. Same sizes and hit area as `attention`; AA at rest, hover and
press over the row wash and every surface (`tests/button-tint.test.tsx`). Inbox CTAs (card heads, phone full-width verbs)
keep the filled tint.

**Settings rows.** `dshx:settings-row` on each Settings row: an inset 1px hairline and a full-row hover/focus wash that
bleeds 8px past the text (`dshx:bg-none` drops the last row's hairline); `dshx:settings-heading` (18/24 600, 40px
above and 12px below), `dshx:settings-label` (14/20 500) and `dshx:settings-description` (13/18 400, secondary ink). On a native row
use the important form through an arbitrary variant (`dshx:[&_[class$=row]]:settings-row!`).

**Wrapped code.** `CodeIndent` (`@dshfiles/plugin-ui/lib/code-indent`) hangs a wrapped line 2ch right of its own
indent: `CodeIndent.mark(codeElement)` sets `--dshx-line-indent` on each highlighted `.line`, which the transcript's
wrap rule reads; the kit `CodeBlock` does it per line itself.

**Field trigger.** A popover or menu trigger that shows a value rather than running an action (a date range, a purpose
filter, a project picker) is `Button` `variant="field"`: the `SelectTrigger` look (`triggerLook`, the quiet trigger
below), the value in ink at 400, its chevron in secondary ink. A filter row then reads as one text field with an edge
and calm filled triggers beside it; action buttons (Refresh) stay `outline`. A launcher that stands for a text field
(Search threads) adds `fieldLook` back (`cn(fieldLook)` in its `className`). Outside `Button`, use
`cn(buttonVariants({ variant: 'field' }))`. In a toolbar row beside an Input, SearchInput, Combobox or Select, give a
field-look launcher or trigger `size="field"` (council round 9 A4): the one control height (32px, 44px on a coarse
pointer) at 13px with a 14px glyph, so the row is one height; `size="sm"` (28px) never sits among fields, and never
override a Combobox trigger's height.

**Selection: the selected wash and marker.** A selection is a neutral wash: `bg-selected-wash`
(`--dshx-selected-wash`, a warm grey step with no accent hue: light `oklch(0.935 0.004 80)`, dark
`oklch(0.275 0.006 60)`) with ink text (`text-foreground`), so indigo means attention only. A selected list row, nav
item or palette row adds `selected-marker`, a straight 3 x 16px ink pill (`--dsw-alias-label-primary`, radius full) 3px
from the leading edge and centred on the row's height (council round 10 A2: background layers, so it needs no
positioned row and never bends with a rounded corner), and its title at `font-selected` (550). A row whose `place-seat`
tile already shows the selection (`PlaceGlyph` in a selected row) draws no marker. Since council round 11 A1 a row
whose first visual is a glyph, tile or mark draws no marker either: the wash and the 550 title carry the selection.
The kit finds its own leading glyphs (`StatusGlyph`, `ProjectMark`, `PlaceGlyph`/`place-seat`, `ModelMark`,
`NativeProviderMark` as the row's first element, up to four wrappers deep), so a selected `EntityRow` with a `status`
and a palette row that starts with a project tile lose the pill. A plugin row spreads `LEADING_GLYPH_ATTRIBUTE`
(`data-leading-glyph`, found anywhere in the row) on its own leading glyph, or `MARKER_OPT_OUT` (`data-marker="none"`)
on the row itself; both come from `@dshfiles/plugin-ui/components/selection`. Only plain-text rows keep the pill. The
active underline tab draws a
2px ink bar too (council round 7 A1), like the window tab strip; the checked switch, checkbox and radio fill
`control-on`, the ink, with the tick or knob in `control-on-foreground`. Indigo is attention, the focus ring and links. The kit applies wash and marker to the selected
`EntityRow` and the highlighted `CommandItem`, and the wash alone to a pressed `Toggle`/`ToggleGroupItem`; use the same
classes for a settings category or list row. A chosen card or tile (a theme card, a starter, a plan option) takes
`dshx:selected-card` instead: a 2px ink ring edge (its 1px border plus a 1px inset ring, both ink, so the box keeps its
size) and a 16px ink check badge in the trailing top corner, with no wash (council round 8 A2: the card keeps its own
surface) and no leading marker. Give the card `border` and its normal fill, and drop its own border colour while chosen
(`chosen ? 'dshx:selected-card' : 'dshx:border-border'`). Hover stays the
ink wash (`bg-accent`).

**One selected segment** (council round 10 A3). The segmented `TabsList`, the page's sliding tab indicator and
`SlidingSegments` share `segment-thumb`: paper (`#FEFCFA`) on the `#EBE9E7` track in light, a raised `#302C28` on the
`#23201D` track in dark (`--dshx-segment-thumb`), inset 3px at a 6px radius, a quiet 1px edge (`--dshx-segment-edge`:
the ink at 10% light, white at 7% dark) and no shadow; the selected label is the ink at 550. Give the element a 1px
`border` and add `dshx:segment-thumb`. A text label sits in `SegmentLabel` (`components/ui/tabs`; `TabsTrigger` wraps a
plain string itself), which reserves its 550 width, so selecting a segment never moves its neighbours.

**Navigation identity.** Each rail destination draws its icon in its own tone, glyph only: `--dshx-nav-tone-<id>`
(council round 8 A4) is work 52, observe 118, land 180, threads 235, knowledge 305, agents 350, every hue 40° from the
others and 25° from the status hues; inbox and settings take the secondary ink (Inbox's indigo `AttentionBadge` carries
its colour). Put
`dshx:nav-tone-<id>` on the item, `dshx:text-nav-tone` on its icon, and `dshx:bg-nav-tile` (the tone at 14%) on the
active item's icon seat; the label stays ink (600 when active). The `text-`/`bg-` names keep them clear of the kit's
`[&_svg:not([class*=text-])]` icon colour inside buttons and menu rows. Direct colours exist too:
`dshx:text-nav-threads`, `dshx:bg-nav-threads/14`. Never tint a row, panel or header with them.

**Prompt fill.** The user prompt bubble takes `bg-prompt-fill` (`--dshx-prompt-fill`, a faint cool tint at hue 230:
light `oklch(0.965 0.012 230)`, dark `oklch(0.255 0.018 230)`; council round 6 A5). In a CSS module (chat) read
`var(--dshx-prompt-fill)`. Ink, secondary and faint text and links hold AA on it (`tests/prompt-fill.test.ts`).

**Attention washes.** A row that waits on you outranks a selected one: a Needs-you row takes `bg-wash-needs-you`
(`--dshx-wash-needs-you`, accent hue, light `oklch(0.935 0.032 h)`, dark `oklch(0.29 0.045 h)`) and a Failed row
`bg-wash-failed` (`--dshx-wash-failed`, hue 25, light `oklch(0.94 0.031 25)`, dark `oklch(0.255 0.032 25)`). A
full-width head band (an Inbox card's) takes `bg-wash-needs-you-band` instead: the same in light, calmer in dark
(`oklch(0.29 0.035 h)`). Ink, secondary and faint text and the status glyphs hold AA on all three
(`tests/attention-wash.test.ts`).

**Counts that name a status.** `StatusCount` (`components/work-status`) is a pill with the status glyph at 10px
(`StatusGlyph size="small"`) and a tabular number: `<StatusCount status="needs-you" count={3} />`. Needs you and Failed
sit on their tint pair; other states are a muted chip. A zero draws nothing; `label` sets what a screen reader hears
(default "3 Needs you"). Use it for a group header's count and a page title's count of what waits on you. A `PageTab` takes
`statusCounts` too: with two or more statuses present, the phone shell draws them as a tally of `StatusCount`s in the
segment (◆ 2 ✕ 1, attention first) in place of its `count`; every other shell keeps the plain count.

**The attention badge.** `AttentionBadge` (`components/ui/attention-badge`) is the Needs-you count on a nav glyph or a
tab: `<AttentionBadge count={3} label="need you" />` draws a 16px pill (`dshx:badge-attention`, usable on a plain span)
in the attention fill (light: the Needs-you colour with white text; dark: the accent hue at L 0.72 with L 0.2 text) and
a 2px ring in the surface it sits on, the rail's panel step by default; set `--dshx-badge-ring` on a different surface
(the phone tab bar). A zero draws nothing; past `max` (99) it reads `99+`. Seat it in a trailing corner beside the
glyph, never over it.

**Contextual heading.** `dshx:text-heading` is 15/20 at 600 (size, line height and weight in one class) for an in-page
section heading: a Settings category's sections, an Inbox card title. The page `h1` stays `text-title font-title`.

**Floating surfaces.** A dialog, an alert dialog and the command palette sit on `dshx:surface-dialog`
(`src/surfaces.css`): light keeps the page fill, the hairline and s3; dark is a raised warm fill
(`oklch(0.27 0.006 60)`), a faint light edge (`oklch(1 0 0 / 0.08)`) and one deep shadow (`0 24px 64px rgb(0 0 0 / 0.55)`).
Inside it, in dark, the selection wash lifts to L 0.30 and the faint text step to L 0.68 (AA on that selection), and
`bg-popover` takes the dialog fill, so a `Command` inside is one tone with its card.
`Kbd` is the one shortcut chip in both schemes and on every surface (council round 10 A5): 20px, the raised step
(`--dshx-kbd-fill`, `tone-2`) with a 1px hairline (`--dshx-kbd-border`, `border-l2`), secondary ink at 12/500 with
tabular numerals, in `--dshx-kbd-font`: the UI sans with the platform symbol faces before the generic fallback, so ⌘ ⌥ ⇧
never fall to a serif face. The palette footer, a row's `KeyHint` and a menu shortcut all use it. A palette the kit does not draw adds `dshx:border
dshx:surface-dialog` to its own card.

**One field look.** Text-entry fields, `Input`, `Textarea` and `InputGroup` (so `SearchInput`), share `fieldLook`
(`components/ui/input`): a 1px `border-field-border` boundary (`--dshx-field-border`, light `#88827d`, dark `#76706c`:
3:1 on bg, panel, raised, the nav column and the dark dialog fill, WCAG 1.4.11; council round 6 A2), the page fill
(`bg-background`), the 8px radius, no shadow and no dark fill. `Checkbox` and `RadioGroupItem` edges use the same
boundary; a text field a plugin draws itself takes `dshx:border-field-border` too. A checkbox column in a dense table takes `Checkbox
size="sm"` (council round 11 A5): the same 16px box and 44px touch area, a 12px tick at an absolute 1.5px stroke, no
shadow. Dividers and card hairlines stay
`border-border`. **The quiet trigger** (council round 10 A1): a control that opens a list and shows a value, the
`Select` and `Combobox` triggers, `Button variant="field"` and `select-look`, shares `triggerLook`: `bg-trigger-fill`
(`--dshx-trigger-fill`, the ink at 5% light / 5.2% dark, so it paints `oklch(0.955 0.004 65)` / `oklch(0.235 0.006 65)`
on the page and stays a visible step on a panel, the nav column, raised or a dialog), a quiet 1px hairline at rest
(`border-border`, `--dsw-alias-border-l2`; council round 11 A2, so a chip never vanishes into its surface), the 3:1 field edge on hover and while open, and the accent edge plus the kit ring on focus; the box never changes size.
**A typeable combobox** (council round 11 A4), a text field that also opens a list and sits beside quiet triggers
(Review's "Compare against"), takes `Input rest="trigger"` (or `typeableTriggerLook` on a wrapper that holds the
input): the trigger look at rest, then the field look (page fill, 3:1 edge) on hover, while open and while it has
focus, so while you type, with the accent edge and ring on focus as every field. **One control height** (council round 5 A1): `--dshx-control-h` (`dshx:h-control-h`), 32px and 44px on a
coarse pointer, sizes `Input`, `InputGroup`, `Combobox`, the default `Select` trigger, `select-look`, the segmented
`TabsList` (items inset 3px) and default-size `Button`s (so `Page` header actions); every `Button` size shares the 8px
radius. The trigger takes that height (`size="sm"` 28px for a dense toolbar) with the chevron in secondary ink at full strength;
`selectLook` (`components/ui/select`) is its whole class string. A control the kit does not draw (a Host select in a
native settings row) takes the `dshx:select-look` utility through an arbitrary variant
(`dshx:[&_[class*=_select]]:select-look`). A number with a unit is one `UnitInput` (`components/ui/unit-input`):
`<UnitInput aria-label="Font size" unit="px" value={14} onChange={…} />`, the unit a muted inner suffix that a screen
reader hears with the field, never a number glued to a second control.

**One disclosure** (council round 5 A5). `DisclosureTrigger` (`components/ui/collapsible`, inside a `Collapsible`) draws
a 16px chevron in secondary ink before its label and turns it a quarter when open (still under reduced motion);
`DisclosureChevron` is that chevron for a trigger you draw yourself inside a `dshx:group/disclosure`. A `<details>` takes
`className="dshx:disclosure"`: the native ▶ marker is hidden in every engine and the same chevron is drawn before the
`summary`. `CollapsibleTrigger` stays the plain Radix trigger for `asChild` callers.

**Change counts.** `DiffStat` (`components/diff-stat`) is the one reading of a diff's size:
`<DiffStat added={48} removed={3} />` draws `+48 −3`, always both sides with additions first, sans with tabular figures
at the 12px meta size, additions in `text-success` and deletions in `text-destructive` (AA on bg, panel, raised and the
selected wash), a zero side muted, the minus U+2212. A screen reader hears "48 lines added, 3 lines removed" (`label`
overrides it). Use it for review summaries, file headers, tool rows and change pills instead of hand-built spans.

## Shared components

Audit of UI rebuilt across owned plugins (native forks excluded), October 2026. Add a component here only when three or
more plugins repeat the same behavior; otherwise compose the existing kit.

| Pattern                                                         | Duplicates found                                                                                                                                                                                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status dot (rounded `size-1.5`/`size-2` span)                   | 37 in 12 plugins: ai-accounts (8), backlog (8), thread-sidebar (7), jj-integration, main-tabs, mcp-servers, usage, worktree-memory (2 each), agent-communication, editor, settings-shell, workbench | `StatusDot`, all migrated. multi-host keeps its own host-state dot; the Host `StateDot` has fixed session states only. Quota chart markers in ai-accounts are plot glyphs, not status dots.                                                                                                                                                                                                                                                                                                                                                                                  |
| Search field (input group + leading `SearchIcon`)               | 11 input groups in 9 plugins, 9 hand-rolled `SearchIcon` over `Input`, 4 native inputs                                                                                                              | `SearchInput`; migrated 8 input groups (activity-timeline, agent-toolkit, background-jobs, mcp-servers, secret-catalog, traces ×3) and 3 hand-rolled (agent-communication, usage, workbench). Left as is: fields with a clear button (plugin-marketplace, settings-shell), a trailing or 14px glyph (jujutsu, mcp quick panel, secret overlay), a shortcut hint or custom height (ai-accounts), path entry (project-folder-picker), keyboard handoff in a picker (model-effort-picker), and borderless native inputs inside custom chrome (backlog, memory, jj-integration). |
| Copy button with a timed "copied" check                         | 4: ai-accounts, jj-integration, memory, thread-sidebar                                                                                                                                              | `useCopyFeedback` hook rather than a component: the four buttons differ in glyph, label and tooltip, only the write and the 1.5 s flag are shared. Plain one-shot copy actions keep calling the Host `writeClipboard`.                                                                                                                                                                                                                                                                                                                                                       |
| Page header (`h1` + one-line description + badge/action row)    | 3 identical: activity-timeline, agent-communication, background-jobs; ~10 more with their own type scale, icon tile or back link                                                                    | `PageHeader` for the identical three. The others differ on purpose (`text-lg` vs `text-xl`, `text-sm` descriptions, icon tiles, back buttons), so migrating them would change how they look.                                                                                                                                                                                                                                                                                                                                                                                 |
| Pending icon swap (`busy ? <Spinner /> : <Icon />`)             | ~25 in 12 plugins                                                                                                                                                                                   | Rejected: the icon, size, label and tooltip vary per button, and `Spinner` already names the busy state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Inline error text (`<p role="alert" class="text-destructive">`) | ~30 in 6 plugins                                                                                                                                                                                    | Rejected: sizes differ (`11px`, `xs`, `sm`) with the surrounding text; `FieldError` covers form fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Key/value list (`dl` grid)                                      | 18 in 11 plugins                                                                                                                                                                                    | Rejected: every grid uses its own column template and density.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Empty and loading states                                        | muted `<p>` texts in ~30 files                                                                                                                                                                      | Rejected: one-line copy in context; the kit `Empty` covers full empty panels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `window.confirm`                                                | 1 (backlog reply delete)                                                                                                                                                                            | Kept: a single case; `AlertDialog` is the kit answer when it next changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Gallery components in use

The [component gallery](../component-gallery/README.md) demos every composite below. Each one replaced local markup on
the screen named; when a screen needs a prop the component lacks, add it here rather than forking the component.

| Component                                          | Used by                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `TraceWaterfall`, `AgentTimeline`, `CallStackTree` | traces: span tree, session traces, span exception frames                                  |
| `StackTrace`, `CodeBlock`                          | test-runs: failing test frames and code frames, Stack trace card under bash               |
| `MergeChecks`                                      | diffs-review Land card                                                                    |
| `MergeConflictGraph`                               | jj-integration workspace menu conflict notice                                             |
| `FallbackChain`                                    | model-effort-picker fallbacks, with a "Serving now" rung                                  |
| `CreditsUsage`                                     | ai-accounts quota windows                                                                 |
| `SpendMap`                                         | usage › Cost                                                                              |
| `ActivityFeed`                                     | activity-timeline rows                                                                    |
| `RoutineList`                                      | project-automations rows                                                                  |
| `BulkSelectList`                                   | jujutsu workspace cleanup selection                                                       |
| `AgentRoster`                                      | agent-communication live agent list                                                       |
| `StepTrail`, `AgentRunSteps`                       | agent-plan activity strip and plan steps                                                  |
| `PipelineRun`                                      | project-checks receipts                                                                   |
| `CheckpointGraph`, `CostWaterfall`, `PresenceList` | session-undo rewind preview, usage thread Cost facet, agent-plan activity strip           |
| `Page`, `PageSection`, `EmptyState`, `EntityList`  | most owned pages                                                                          |
| `ComposerRow`                                      | background-jobs, jujutsu, queue-reorder, rich-composer: the state rows above the composer |

Deleted rather than adopted: `MergeChecklist` (overlapped `MergeChecks`), `TestRunResults` (a streaming view, while
test-runs shows finished runs and its counts would be wrong for Vitest's default reporter), `QuotaMeter`, `Typewriter`
and `SessionRecap` (no caller).

Kept with no caller yet, each for a named future feature: `PipelineDag` (project actions with dependencies),
`WorkflowRun` (an owned `workflow` tool card), `DelegationBoard`, `ApprovalRun` and `AgentRunStatus` (fan-out approval
and child status pills, [ADE UX](../../../docs/ade-ux/README.md) Phase 7), `DelegatorBoard` (Inbox grouped by source),
`AgentQueue` (host-pool work queue), `ClarifyPrompt` (an owned ask_user_question card), `ToolbarWalkthrough`
(plugin-guide onboarding), `ShapeshiftCard` (palette actions that morph into a form), `RevisionScrubber` (rewind any
turn), `RevisionAvatarGraph`, `AgentCursors` and `AgentPresenceBar` (thread-share v2 presence), `AccessMap` (a
policies scope view). Not done: `ContextGraph` as an optional graph view of agent-toolkit's Context facet. `ActivityDock` was
deleted once turn-summary's walkthrough became a row toggle; its `DockChanges` list stays in `motion/activity-dock`
for that walkthrough.

Recount a component's callers outside the kit and the gallery:

```sh
cd plugins/@dshfiles
grep -rlE --include='*.tsx' '<TraceWaterfall([ >/]|$)' */src | grep -v '^component-gallery/\|^plugin-ui/\|\.test\.'
```

## Motion

Every animated component uses one engine and one feel, and every one is visible in the
[component gallery](../component-gallery/README.md).

```ts
import { animate, springs, presets, motionSafe, enter, flip, drawStroke, everyFrame } from '@dshfiles/plugin-ui/motion'
import { useAnimate, useEnter, useFlip, useCountUp, useElapsed, useInView } from '@dshfiles/plugin-ui/motion/react'
import { PresenceList } from '@dshfiles/plugin-ui/components/motion/presence-list'
import { RollingNumber, ShimmerText } from '@dshfiles/plugin-ui/components/motion/text'
```

- **Engine: [Motion](https://motion.dev)'s framework-free core** (`motion`, MIT): springs, keyframes, stagger,
  sequences, layout/FLIP, view transitions, `inView`/`scroll`, `hover`/`press`, on plain DOM through Web Animations
  where possible. `motion/react` is not used: the React hooks above are thin refs-and-effects over the vanilla API, so a
  non-React surface shares the same presets. `@dshfiles/shared-runtime` provides `motion`, so plugins share one copy.
- Use the presets, not ad-hoc numbers: `springs.snappy` (chrome), `springs.smooth` (content, layout),
  `springs.bouncy` (confirmation), `springs.gentle` (large surfaces); `durations`, `easings`, `staggers`, and the
  enter/exit keyframes in `presets`. The helpers are grouped on the `Motion` class; the short names are aliases.
- **Reduced motion:** pass every option object through `motionSafe` (the helpers and hooks already do). Under
  `prefers-reduced-motion` the animation ends on its final frame at once and `PresenceList` removes items immediately;
  CSS loops use `dshx:motion-reduce:animate-none`.
- Two CSS utilities need no JavaScript (`src/motion-utilities.css`): `dshx-reveal` opens a block by its height
  (`grid-template-rows` 0fr → 1fr, its one child clipped) and `dshx-pop-in` fades an overlay in with 4px of travel.
  Both enter in 120ms on mount or when `data-state="closed"` goes, leave in 100ms when it comes, and are opacity only
  under reduced motion. `dshx-pop-in` owns `translate`, so do not add a `translate-*` utility to it.
- Live clocks and running bars use `everyFrame`/`useElapsed`, never `setInterval` inside a component. Simulated data
  belongs to gallery demos; components stay controlled by props. A clock's text comes from `formatElapsed`
  (`lib/format-duration`); `LiveElapsed` ticks it on the page's one shared second timer.
- A time of day comes from `formatClockTime(at, { seconds?, locale? })` (`lib/format-clock-time`, council round 5 A6):
  the locale's 12/24 h choice, printed one way everywhere — `15:45` / `09:05` in a 24-hour locale (the transcript's
  turn time), `3:45 PM` in a 12-hour one, never `24:00`. Never a local `toLocaleTimeString` with its own options.
- Do not put Tailwind `scale-*`/`rotate-*`/`translate-*` classes on an element Motion animates: they set the separate
  CSS `scale`/`rotate`/`translate` properties, which compound with Motion's `transform`.
- Inline styles cannot use the `--dshx-color-*` theme variables (they are declared on `:root`, where the Host's
  `--dsw-*` tokens are not defined, so they resolve to nothing). Use the `--dsw-alias-*` token directly, as
  `ShimmerText` does, or a utility class.
- Animated components live in `src/components/motion/`: agents (queues, run steps, routines, delegation, rosters,
  checkpoints, plans), traces (timeline, waterfall, replay, cost waterfall, fallback chain), usage (credits, spend map,
  activity feed/dock, session recap, access map, landing pipeline), revisions (scrubber, merge conflicts, merge checks,
  pipeline DAG, call stack, avatar graph) and interaction (bulk select, run status, approvals, clarify prompt,
  toolbar walkthrough), plus shared parts (`lane-graph`, `node-links`, `trace-kit`, `sliding-segments`, `step-glyph`,
  `auto-height`, `height-reveal`, `elapsed-clock`, `agent-avatar`).

## Query

```tsx
import { PluginQueryProvider, errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
```

Wrap each slot root once (inside dshx `decorate(...)`). Prefix every key with the plugin id, forward `signal` to the dshx client, invalidate by key after mutations. One client per plugin bundle. When DSH answers again after an outage (below), the provider invalidates its client's queries once, however many providers share the client.

## Connection

```tsx
import { HostConnection, useHostConnection } from '@dshfiles/plugin-ui/lib/host-connection'

const connection = useHostConnection() // 'online' | 'reconnecting' | 'offline'
{connection === 'online' && <Button onClick={cleanUp}>Clean up</Button>}
```

settings-shell is the one publisher (`HostConnection.publish(view)`, where its probe's `checking` reads as
`reconnecting`); everyone else reads. The state lives on the page, not in the module: `publish` sets
`html[data-host-connection]` (absent when online) and dispatches `dshfiles:host-connection` on `document`, and
`read`, `subscribe` and `useHostConnection` read that attribute, so a bundle with its own inlined kit copy agrees.
While it is set, every `LiveElapsed` stops at its last value, the `StatusGlyph` and native StateDot spinners and the
working shimmer stand still, and a verb that archives, lands or cleans up is not offered (DESIGN.md Connection).
`LiveElapsed` is a silent `role="timer"`.

## Errors

```tsx
import { errorSentence } from '@dshfiles/plugin-ui/lib/error-copy'
import { LoadError } from '@dshfiles/plugin-ui/components/load-error'

if (query.isError) return <LoadError subject="Inbox" error={query.error} onRetry={() => void query.refetch()} />
toast.error(errorSentence({ subject: 'Message', error, kept: 'Your message is kept; send it again once DSH is back.' }).sentence)
```

`errorSentence({ subject, error, kept? })` returns `{ kind, sentence, detail, retry }` for the five classes in
DESIGN.md (Error copy): `unreachable`, `request`, `missing`, `credential`, `refused`. It reads the fields dshx's
`ApiError` carries (`kind`, `status`, `endpoint`, `remoteCode`), never an endpoint in the text, and keeps the raw
text, code and endpoint in `detail`. `retry` says whether Retry leads (`primary`), follows (`secondary`) or is not
offered (`none`). `LoadError` draws the sentence, Retry and a Details disclosure; pass `sentence` and `actions` for a
case it cannot know (a destination whose plugin did not load: Reload and Open Plugins).

## Table (TanStack Table v9)

```tsx
import { DataTable, createColumnHelper, tableFeatures, useTable } from '@dshfiles/plugin-ui/table'
;<DataTable table={table} empty="No rows" /> // shadcn Table in a bordered card, uppercase headers, aria-sort
;<DataTable table={table} append={<TableRow>…</TableRow>} /> // extra rows (e.g. drafts) after the row model; empty is skipped
```

## Form (TanStack Form)

```tsx
import { useAppForm } from '@dshfiles/plugin-ui/form'
;<form.AppField name="alias">{field => <field.TextField label="Alias" required />}</form.AppField>
```

Field components: `TextField`, `TextAreaField`, `SelectField` (shadcn Select), `CheckboxField`, `SwitchField`; `form.SubmitButton`. Validators are Standard Schema (zod 4).

## Machine (xstate v5)

```tsx
import { assign, fromPromise, setup, useMachine } from '@dshfiles/plugin-ui/machine'
```

The subpath names each xstate export a plugin uses; add a name there when a plugin needs another.
Only for tangled flows with three or more states (select → prepare → confirm → receipt). Machines own flow state; server data stays in Query. Call the Host through `fromPromise` actors and forward their `signal` — leaving a state stops the actor and aborts the call.

## Chart

`@dshfiles/plugin-ui/chart` re-exports TanStack Charts 1.0.0 and `ChartFrame`, which maps `--ts-chart-*` onto DSH tokens.

## Code and stack traces

```tsx
import { CodeBlock, FilePath } from '@dshfiles/plugin-ui/components/code-block'
import { CodeFrame, StackTrace, locationFrame } from '@dshfiles/plugin-ui/components/stack-trace'
import { StackFrames } from '@dshfiles/plugin-ui/lib/stack-frames'

;<CodeBlock code={source} path="src/cart/pricing.ts" startLine={27} highlightLines={[29]} />
const report = StackFrames.extract(output) // first error + frames in command output, or undefined
;<StackTrace frames={report.frames} openFile={openFile} />
```

- `CodeBlock` highlights with the Host's lazy Shiki grammars (`useCodeHighlighter`, grammar from `path` or `lang`) and
  draws a header with the path or language, a wrap toggle, copy and download (`downloadable={false}` hides it). The
  gutter counts from `startLine` (`false` hides it), so a fragment cut from line 27 reads 27; the Host `CodeBlock`
  always counts from 1 and has no wrap or download. `Code` (`components/code`) stays the Host block for Markdown-style
  fences.
- `StackFrames.parse(stacktrace)` reads V8, JVM, Gecko and Python stacks into `CallFrame`s, innermost first, with
  `file`, full `path`, `line` and `column`; application frames are `changed`, library and runtime frames
  (`node_modules`, `node:`, `site-packages`, `java.`) `existing`. `StackFrames.extract(output)` finds the first error in
  command output with its header (`TypeError: …`, a JVM `Exception in thread`, a Python traceback's last line) and its
  frames. With no header above, only two or more `at …` lines count as a trace; a `file:0` line (`grep -c`) or a Gecko
  location that is not a URL or absolute file path is never a frame, and a `Caused by` chain ends it.
- `StackTrace` shows the location, the `CodeFrame` (a `CodeBlock` numbered from the frame's first line, failing line
  marked) and the frames as flat mono rows (name, then a dim `file:line`) with no card or heading of its own, so it sits
  inside a `ToolCard`. Each run of library frames folds into one "N library frames" row that expands in place. Selecting
  a frame calls `openFile(path, { line })`. `locationFrame` turns a Vitest `file:line:column` location into a frame with no function
  name (`bare`).

Adopters: test-runs (failing tests, and the Stack trace card under any bash call that crashed) and traces (span
exception frames). The gallery's Code tab demos all three.

### Design references

The Code Block, Stack Trace and Diff Review rows of [HextaUI](https://hextaui.com/blocks) were design references.
HextaUI's repository ([preetsuthar17/hextaui](https://github.com/preetsuthar17/hextaui), `LICENSE`: MIT, © 2026 Preet
Suthar) covers its free components, hooks and utilities: those may be ported here with that notice kept in the ported
file. Its blocks are HextaUI Pro under the [Pro License](https://hextaui.com/legal/license), which allows Pro and free
blocks (Prompt Input included) inside an open-source end product but forbids redistributing them as part of a UI kit or
component library, which this package is. So blocks are only ever rebuilt here from their visible behaviour, and no
HextaUI code is vendored in this package. HextaUI builds on Base UI and Tabler icons; ports land on the Radix parts and
lucide icons this package already has rather than adding Base UI.

Its other blocks were compared against what this repository already ships, and no port is left to do:

| Block                | Where the behaviour lives here                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subagents            | `thread-sidebar` subagent lineage header (mode, activity, duration, tokens) plus the state on the subagent tool row.                                                                       |
| Tool Calls           | `tool-meta`: the native call tree wrapped with section rows and timings, and the approval card with its risk level.                                                                        |
| Prompt Input         | `rich-composer` uploads row, model chip and the Stop/retry controls in its input bar.                                                                                                      |
| Chat Sidebar         | `thread-sidebar`: status groups with headers, per-filter empty copy, unread and archived handling.                                                                                         |
| Settings, Appearance | `settings-shell`: one Settings page grouped by task, with `settings-search` over sections, plugin pages, controls and key bindings.                                                        |
| API keys             | `secret-catalog` rows show alias, scope and last use; a value can never be masked and shown, because DSH stores references only ([secret references](../../../docs/secret-references.md)). |
| Models               | `model-effort-picker`: model groups per provider, provider labels on the chips and the per-model fallback list.                                                                            |
| Notifications        | `thread-sidebar` notification settings: per-category toggles, placement and duration, plus desktop notification support.                                                                   |
| Billing              | `usage`: cost and quota bars, tool share bars and the per-account usage history; there is no billing data to summarise.                                                                    |

## Diff

`@dshfiles/plugin-ui/diff` wraps `@pierre/diffs` 1.5.2 (Shiki-based, Apache-2.0). `PatchView` takes a git patch
string (`patch`) or pre-parsed `files` (`parsePatchFiles(patch).flatMap(p => p.files)`), a `layout` of `unified`
(default) or `split`, an optional `focusPath` to scroll to, and `empty` content. It virtualizes files and lines, so
megabyte patches stay responsive; give it a bounded height through `className`. Light/dark follows
`body[data-ds-dark-theme]`. It highlights with the `dshx-syntax` theme (Shiki `css-variables`), so a diff and the
transcript's code blocks share one syntax pair (`--shiki-token-*`, fitted per scheme in `theme/theme-css.ts`); its
body sits on the ramp with 12% add and delete tints, `+`/`−` gutter marks and a quiet collapsed-lines bar, all set by
`PatchLook.style()` as inherited custom properties over the theme tones (`theme/diff-look.ts`); a caller adds no diff
colours of its own. Every file renders in its own shadow root
with adopted stylesheets, so no library CSS leaks into the page; style it only through inherited `--diffs-*`
custom properties. `pluginUiVite()` aliases the library's `shiki` import to `src/shiki-slim.ts` (a curated grammar
set on the JavaScript regex engine) and drops unused themes and the WASM engine, because dshx inlines every dynamic
import into one client file; other languages render as plain text. Add a grammar there when a plugin needs one, and
check the bundle. Patch-parsed diffs carry only the patch lines, so collapsed context shows as a count and cannot
expand without full file contents (`loadDiffFiles`).

## Virtual

`@dshfiles/plugin-ui/virtual` re-exports TanStack Virtual 3.14 (`useVirtualizer`, `defaultRangeExtractor`) for long
row lists (jujutsu revision graph). Measure variable rows with `measureElement`; pin sticky headers or a drag source
with a custom `rangeExtractor` so they stay mounted. `PatchView` virtualizes on its own.

## Tests

Radix parts run in jsdom. A Radix `Select` renders a hidden native `<select name=…>`; drive it with `fireEvent.change`. Host primitives still cannot be imported under Node — alias them to `./testing/host-primitives.tsx` in `vitest.config.ts` when a plugin keeps any.

## Host CSS caveat

The Host ships one unlayered `button, input, select, textarea { font-family: inherit }`. Unlayered rules beat Tailwind's layered utilities, so a monospace control needs the important form: `dshx:font-mono!`.

## Shared stylesheet and stacking

- `@dshfiles/ui-styles` is the only bundle that compiles the shared Tailwind sheet: its `src/client.css` imports
  `plugin-ui/styles.css`, whose `@source '../..'` scans every owned plugin, and it injects the result once. Same-specificity
  rules resolve by sheet order, so the sheet must stay one ordered rule set — that is why the union is compiled once
  instead of per plugin; a later plugin's base rule (`max-w-[…]`) would otherwise override an earlier plugin's variant
  (`sm:max-w-2xl`). Consumers ship nothing; after a class change rebuild the owner and the changed plugin.
- Host modals sit at `z-index: 1000`. Kit dialogs/sheets use 1050 and floating layers (select, popover, menus,
  tooltip, hover card) 1100, so they open above Host Settings and above our own dialogs.

## Rules that break silently

Client UI uses `@dshfiles/plugin-ui` (shadcn/ui on Tailwind v4); skills
`plugin-ui` and `plugin-state` hold the details. The rules that break silently:

- Every utility is `dshx:`-prefixed, a complete static string, merged with
  `cn`; `dshx-root` on each surface root; semantic colors only.
- Avoid native JSX `title` attributes for hover help; use the shared
  `@dshfiles/plugin-ui` Tooltip components instead, because native title
  tooltips appear after a long delay. Keep `title` props only for components
  whose prop is actual semantic content (such as a dialog or panel heading).
  Oxlint enforces this with `ui-guidance/no-native-title` and its explicit
  semantic-component allowlist.
- `@dshfiles/ui-styles` is the only bundle that compiles the shared sheet;
  after **any** class change, rebuild it and the plugin you changed.
- The touch baseline in `@dshfiles/ui-styles/src/client.css` is the one deliberate page-global element rule set: it
  sets `touch-action` on every native button, link, tab and menu item, and a 16px floor on every native field under a
  coarse pointer. Keep it inside `@layer base`; an unlayered rule there beats `dshx:touch-none` and every other
  `dshx:` utility. Add a new page-global rule to that file only with the same reason, and list it here.
- On a coarse pointer every kit button, toggle, toggle-group item and raw
  `<button>` under `.dshx-root` gets a 44px hit area through `::after` (tabs
  triggers use `::before`). A raw button that draws with an `after:` utility is
  skipped; one that draws with a hand-written `::after` rule loses its drawing, so
  use an `after:` utility or `::before` instead. A control the kit does not draw
  (a native-fork CSS-module button, a chip) takes the plain class `dshx-hit-44`
  for the same hit area.
- Where nothing can hover (`(hover: none)`) a kit `Tooltip` does not open on its
  own: a tap would leave the label over the content. Pass `open` to control one.
- A `destructive` button fills with `bg-destructive-solid` (white text holds
  4.5:1 in both schemes; the dark `destructive` tone is a text colour). A
  required field's `*` is muted: red means Failed only.
- Avoid native JSX `<select>` controls; use `Combobox` from
  `@dshfiles/plugin-ui/components/ui/combobox` instead, matching the New Thread
  picker for consistent, searchable selection. The `no-native-select` lint rule
  enforces this.
- A fixed overlay (sheet, scrim, popover, toast) portals to `document.body`.
  Inside an ancestor with `transform`, `filter` or `contain`, `position: fixed`
  resolves against that ancestor: the phone thread `⋯` sheet rendered inside the
  translated top bar came out 157px wide, above the screen.
- A menu row that opens another overlay runs it from the menu's
  `onCloseAutoFocus`, after the menu unmounts, not from `onSelect` or a
  `setTimeout(0)`. The closing menu's focus trap otherwise pulls focus back and
  the new popover dismisses itself as "focus outside" (Saved prompts, Prompt
  history and Send later closed within a second).
- Project pickers should list registered projects, not JJ thread workspaces;
  use `EntityLabels.projectsOf` when deriving choices from the workspace list.
- Host/async data → `/query`, multi-field forms → `/form`, tangled flows →
  `/machine`, localStorage → `createStoredValue`.
- Prefer Host utilities (`relativeTime`, `writeClipboard`, `rankByName` from
  `@deepseek-ai/dsh-client-ui-primitives`) over local copies.
- **Multi-select only when a repeated row verb is worth batching.** Add it to
  a list whose rows share a routine verb (move, mark, enable, stop) and whose
  batch saves real work; skip it for detail panes and for lists whose rows have
  unrelated actions. Use one model: plain click selects one row — or runs the
  row's existing verb when it already has one — Cmd/Ctrl-click toggles the
  selection, Shift-click extends the inclusive range from the anchor, and the
  header checkbox selects exactly the rows visible under the current filter,
  group or scope; changing any of those drops ids that are no longer visible.
  A batch action keeps each single-row verb's rules, refusals and confirmations,
  and a bulk destructive verb (forget, stop, remove) opens an explicit
  confirmation that names the count — it never runs from a bare click.
