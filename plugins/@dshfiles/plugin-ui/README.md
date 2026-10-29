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
- Components: `src/components/ui/` (button, input, textarea, label, select, checkbox, switch, tabs, badge, card, table, dialog, alert-dialog, dropdown-menu, context-menu, popover, tooltip, command, combobox, separator, skeleton, toggle, toggle-group, collapsible, alert, kbd, spinner, empty, field, input-group, item, progress, scroll-area, search-input, status-dot). Wrap tooltips in `TooltipProvider`.
- `SearchInput` (`components/ui/search-input`) is the search field: the input group with a leading search glyph. `className` sizes the group; `aria-label`, `value`, `ref` and every other prop reach the input.
- `StatusDot` (`components/ui/status-dot`) is the round status marker: `tone` (`current`, `success`, `destructive`, `warning`, `info`, `muted`) or a computed color class, `size` `sm` (6px) or default (8px). It is `aria-hidden` unless given an `aria-label`, which makes it `role="img"`; it forwards its ref so a `TooltipTrigger asChild` can wrap it.
- `components/image-lightbox` (`ImageLightbox`) is the one full-window image viewer: arrow keys and side controls move, the thumbnail strip jumps, Escape closes and focus returns to the opener, and an image without `src` shows as loading. The thread composer and the backlog composer both render it, so a gallery change lands in one place. Labels default to English and accept a translated `ImageLightboxLabels`.
- Agent cards: `components/tool-card` (`ToolCard` on the Host `DisclosureRow`, `StatusIcon`) and `components/stack-trace` (`StackTrace`, `CodeFrame` highlighted by the Host grammar with the file's own line numbers, `FilePath`). Prefer the Host `CodeBlock` and `TerminalBlock` for whole files and command output.
- Icons: `import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'` (lucide-react re-exported, so plugins need no extra dependency); Host `Icon*` from `@deepseek-ai/dsh-client-ui-primitives` where a DSH-native glyph matters.
- Readable names: `EntityLabels` (`@dshfiles/plugin-ui/hooks/entity-labels`) turns Session ids into thread titles (`useSessionLabel`) and workspace ids or folders into project names (`useWorkspaceLabel`); `isThreadWorkspace` and `groupByRepository` fold jj thread workspaces under their repository. Pass it the injected `ctx.sessions` / `ctx.workspaces`.
- Copy feedback: `useCopyFeedback` (`@dshfiles/plugin-ui/hooks/copy-feedback`) copies through the Host `writeClipboard` and returns `copied` for 1.5 s after a successful write, for a copy button that swaps its glyph or label. `copy` resolves to whether the write succeeded, so a caller can still report a failure.
- List selection: `ListSelectionModel` (`@dshfiles/plugin-ui/hooks/list-selection`) is the shared anchored selection for batch lists — `toggle`, `extend` (inclusive Shift range from the anchor), `toggleAllVisible` (visible-only select-all), and `prune` (drop ids a filter, group or scope hid). Keep selection in `useState<ListSelection<Id>>`; the batch bar and any confirmation belong to the list, not the model.
- Infinite lists: `useLoadMore` (`@dshfiles/plugin-ui/hooks/use-load-more`) observes a sentinel near a scroll boundary and re-arms when its `resetKey` changes, so short lists keep filling until the sentinel leaves the root. Change the key after content grows, disable the hook while a page is pending, and keep its callback fresh through a ref. Keep older-page sentinels before all rows; `usePrependScrollAnchor` (`@dshfiles/plugin-ui/hooks/use-prepend-scroll-anchor`) preserves the visible position when older rows prepend.
- Small views: `dshx:@container` on a surface root, then `dshx:@max-pane-narrow:` (< 28rem) and `dshx:@max-pane-compact:` (< 42rem) on its children. Panels follow their own width, not the viewport; the collapse-order rules are in the `plugin-ui` skill.

### Adding a registry component

```sh
cd plugins/@dshfiles/plugin-ui
pnpm dlx shadcn@4.21.4 add <name-or-registry-url>
```

`components.json` sets the `dshx` prefix and self-referencing aliases. After adding, rewrite `@dshfiles/plugin-ui/...` and `cn` imports in the new file to relative `.js` paths (`../../lib/utils.js`, `./button.js`, so NodeNext consumers typecheck) — the CLI resolves them inconsistently — check it did not add stray dependencies, and use `React.forwardRef` on any part a Radix `asChild` trigger wraps (React 18 drops `ref` on function components).

## Query

```tsx
import { PluginQueryProvider, errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
```

Wrap each slot root once (inside dshx `decorate(...)`). Prefix every key with the plugin id, forward `signal` to the dshx client, invalidate by key after mutations. One client per plugin bundle.

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

## Diff

`@dshfiles/plugin-ui/diff` wraps `@pierre/diffs` 1.5.2 (Shiki-based, Apache-2.0). `PatchView` takes a git patch
string (`patch`) or pre-parsed `files` (`parsePatchFiles(patch).flatMap(p => p.files)`), a `layout` of `unified`
(default) or `split`, an optional `focusPath` to scroll to, and `empty` content. It virtualizes files and lines, so
megabyte patches stay responsive; give it a bounded height through `className`. Light/dark follows
`body[data-ds-dark-theme]` with the `pierre-light`/`pierre-dark` themes. Every file renders in its own shadow root
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
- Avoid native JSX `<select>` controls; use `Combobox` from
  `@dshfiles/plugin-ui/components/ui/combobox` instead, matching the New Thread
  picker for consistent, searchable selection. The `no-native-select` lint rule
  enforces this.
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
