---
name: plugin-ui
description: Build and style DSH plugin UI with @dshfiles/plugin-ui (shadcn/ui on Tailwind v4, `dshx:` prefix), add shadcn registry components to the kit, and rebuild every UI plugin after class changes. Use when writing or restyling any client component under plugins/@dshfiles/*, touching plugin-ui, or debugging plugin CSS (lost variants, wrong z-index, wrong font).
---

# Plugin UI kit

`plugins/@dshfiles/plugin-ui` is shadcn/ui on Tailwind v4 for every owned plugin. Its `README.md` is the reference
(wiring, component list, Table/Chart/Diff); this skill holds the rules that bite.

## Writing classes

```tsx
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

<section className={cn('dshx-root dshx:flex dshx:flex-col dshx:gap-4', busy && 'dshx:opacity-60')}>
  <Button variant="outline" size="sm"><RefreshCwIcon /> Refresh</Button>
  <input className="dshx:font-mono! dshx:text-sm" />
</section>
```

- Prefix **every** utility, variants included: `dshx:hover:bg-accent`, `dshx:sm:max-w-2xl`. Write complete static
  strings — no `` `dshx:text-${tone}` ``; Tailwind only sees literal classes.
- `dshx-root` on each surface root you render (scoped Preflight applies under it and inside shadcn portal content).
- Semantic colors only (`bg-background`, `text-muted-foreground`, `border-border`, `bg-destructive`, `text-success`…);
  `styles.css` maps them to the Host `--dsw-*` tokens. `dark:` matches `body[data-ds-dark-theme]`.
- The Host ships unlayered `button,input,select,textarea{font-family:inherit}`, which beats layered utilities: use
  `dshx:font-mono!` on controls.
- Stacking: Host modals are `z-index: 1000`; kit dialogs/sheets 1050; floating layers (select, popover, menu,
  tooltip, hover card) 1100. Keep new overlays in those bands.
- Scoped Preflight never targets bare `[data-slot]` — DSH tags its own outlets with `data-slot`.
- Icons from `@dshfiles/plugin-ui/icons` (lucide re-export); diffs via `@dshfiles/plugin-ui/diff` `PatchView`
  (`@pierre/diffs`, slim Shiki — add grammars in `src/shiki-slim.ts`).
- Prefer Host utilities from `@deepseek-ai/dsh-client-ui-primitives` over local copies: `relativeTime`,
  `writeClipboard`, `rankByName`.

## Small views: container queries, not viewport breakpoints

Plugin surfaces render in 360–480 px panes, split layouts and the composer, so size them by their own width:

```tsx
<main className="dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-4 dshx:p-5 dshx:@max-pane-narrow:p-3">
  <div className="dshx:flex dshx:flex-wrap dshx:gap-2 dshx:@max-pane-narrow:flex-nowrap dshx:@max-pane-narrow:overflow-x-auto">…</div>
</main>
```

- `dshx:@container` on the surface root (page, panel, card); children query it with `dshx:@max-pane-narrow:` (< 28rem,
  phones and 360–480 px panes) and `dshx:@max-pane-compact:` (< 42rem, split layouts). The tiers live in `styles.css`.
- Never `sm:`/`md:`/`xl:` inside a panel: those follow the viewport, not the pane.
- Declare a collapse order per surface and keep it in this order: labels become icons (`sr-only` keeps the accessible
  name), secondary chips hide, then the primary text truncates (`min-w-0 truncate`), and only then does a row wrap.
- `min-w-0` on every flex child that holds text, and `shrink` on a `Button` (its base class is `shrink-0`).
- A container's inline size cannot come from its content: give it a width (`w-80 max-w-full`) or let a parent size it.
  It also cannot query itself: put `@max-*` classes on its children, not on the `@container` element.
- The composer row is a native container: composer slots query it directly. Order there: Drafts and Prompts lose their
  labels (`@max-pane-compact`), the jj dock chips collapse to the working-copy chip, the model name truncates
  (`100cqw`), and the row's own `data-model-compact` hides the name only when even that does not fit; the effort
  never truncates.
- Check 360, 480, 768 and 1024 px plus a split layout (see `verify-dsh`).

## Rebuild every UI plugin after any class change

Each plugin injects its own copy of the Tailwind sheet. dshx dedupes them by **content hash**
(`tooling/dshx/packages/dshx/src/compiler/client/css.ts`), and `styles.css` scans every owned plugin
(`@source '../..'`) so the copies are byte-identical. Change a class in one plugin and rebuild only that one → the
hashes diverge, several sheets load, and same-specificity rules resolve by sheet order (e.g. a later `max-w-[…]`
beats an earlier `sm:max-w-2xl`). So after any class change anywhere:

```sh
# from the repository root
for dir in $(grep -l '"@dshfiles/plugin-ui"' plugins/@dshfiles/*/package.json | xargs -n1 dirname | grep -v '/plugin-ui$'); do
  pnpm --dir "$dir" build || { echo "FAILED: $dir"; break; }
done
```

Budget: `tooling/dshx/e2e/features/palette-performance.feature` asserts exactly one shared plugin stylesheet.

## Adding a shadcn registry component

```sh
cd plugins/@dshfiles/plugin-ui
pnpm dlx shadcn@4.21.4 add <name-or-registry-url>   # version pinned in README.md
```

Then fix what the CLI gets wrong:

1. Remove any junk dependency it added (e.g. a `cn` npm package) from `package.json`.
2. Rewrite `@dshfiles/plugin-ui/...` / `cn` imports to relative `.js` paths (`../../lib/utils.js`, `./button.js`).
3. Prefix classes it missed inside `cva` variant arrays/objects (`grep -n '"[a-z-]*:' <file>` for unprefixed ones).
4. `React.forwardRef` on any part a Radix `asChild` trigger wraps (React 18 drops `ref` on function components) —
   see `button.tsx`.
5. If install fails on a fresh release, pnpm's `minimumReleaseAge` is refusing it: pin an older version.
6. `pnpm --dir plugins/@dshfiles/plugin-ui typecheck && pnpm --dir plugins/@dshfiles/plugin-ui test`, update the
   README component list, then rebuild all UI plugins (above).
