# @dshfiles/plugin-ui

shadcn/ui for dshfiles DSH plugins, plus TanStack Query, Table, Form, and Charts bindings. See `plans/plugin-ui-library.md` for the why.

- **Tailwind v4, `dshx:` prefix, no global Preflight** — the dshx client-CSS contract. A scoped Preflight applies under `.dshx-root` and inside shadcn portal content (`[data-slot$="-content"]`); never bare `[data-slot]`, which DSH also uses for its own outlets.
- **shadcn semantic colors are the DSH theme.** `src/styles.css` maps `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `info`, `success`, `warning`, `chart-1..5` inline onto `--dsw-*`, so light/dark follow the Host. `dark:` matches `body[data-ds-dark-theme]`.
- **BB density.** `text-sm` is 13px, controls are 32px (`sm` 28px, `xs` 24px), radius 6px.

## Wire a plugin

```ts
// dshx.config.ts
import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
export default defineConfig({ client: { entry: 'src/client.tsx', vite: { plugins: [pluginUiVite()] } } })
```

```css
/* src/client.css — imported once from the client entry: import './client.css' */
@import '@dshfiles/plugin-ui/styles.css';
@source './';
```

Depend on `"@dshfiles/plugin-ui": "link:../plugin-ui"`. Do not add Tailwind, Radix, or TanStack packages to a plugin directly — this package pins them.

## Use

```tsx
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

<section className="dshx-root dshx:flex dshx:flex-col dshx:gap-4 dshx:p-6">
  <Button variant="outline" size="sm"><RefreshCwIcon /> Refresh</Button>
  <Badge variant="secondary">6 secrets</Badge>
</section>
```

- Put `dshx-root` on each surface root you render. Prefix every utility (`dshx:hover:bg-accent`), write complete static class strings, merge with `cn`.
- Components: `src/components/ui/` (button, input, textarea, label, select, checkbox, switch, tabs, badge, card, table, dialog, alert-dialog, dropdown-menu, context-menu, popover, tooltip, command, separator, skeleton, toggle, toggle-group, collapsible, alert, kbd, spinner, empty, field, input-group, item, progress, scroll-area). Wrap tooltips in `TooltipProvider`.
- Icons: `import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'` (lucide-react re-exported, so plugins need no extra dependency); Host `Icon*` from `@deepseek-ai/dsh-client-ui-primitives` where a DSH-native glyph matters.

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
<DataTable table={table} empty="No rows" />   // shadcn Table in a bordered card, uppercase headers, aria-sort
```

## Form (TanStack Form)

```tsx
import { useAppForm } from '@dshfiles/plugin-ui/form'
<form.AppField name="alias">{field => <field.TextField label="Alias" required />}</form.AppField>
```

Field components: `TextField`, `TextAreaField`, `SelectField` (shadcn Select), `CheckboxField`, `SwitchField`; `form.SubmitButton`. Validators are Standard Schema (zod 4).

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

## Tests

Radix parts run in jsdom. A Radix `Select` renders a hidden native `<select name=…>`; drive it with `fireEvent.change`. Host primitives still cannot be imported under Node — alias them to `./testing/host-primitives.tsx` in `vitest.config.ts` when a plugin keeps any.

## Host CSS caveat

The Host ships one unlayered `button, input, select, textarea { font-family: inherit }`. Unlayered rules beat Tailwind's layered utilities, so a monospace control needs the important form: `dshx:font-mono!`.

## Shared stylesheet and stacking

- Every plugin injects its own copy of the Tailwind sheet, and same-specificity rules resolve by sheet order.
  `styles.css` therefore scans every owned plugin (`@source '../..'`) so all copies are identical; otherwise a
  later plugin's base rule (`max-w-[…]`) overrides an earlier plugin's variant (`sm:max-w-2xl`). When you add
  classes to one plugin, rebuild all plugins (or at least the ones loaded after it) so the copies stay equal.
- Host modals sit at `z-index: 1000`. Kit dialogs/sheets use 1050 and floating layers (select, popover, menus,
  tooltip, hover card) 1100, so they open above Host Settings and above our own dialogs.
