# Plugin UI library plan

## Context

- DSH plugin clients are React 18 apps built through dshx's Vite pipeline into one lazy ModuleLoader chunk with no CSS assets; CSS Modules are inlined. See [the dshx SDK guide](../tooling/dshx/docs/sdk/getting-started.md).
- **DSH already ships a component library.** `@deepseek-ai/dsh-client-ui-primitives` (MIT, "pure React atoms … styled only through `--dsw-*` tokens") exports `Button`, `Input`, `Checkbox`, `Switch`, `Tag`, `Pill`, `StateDot`, `SegmentedControl`, `SegmentedTabs`, `Menu`/`MenuItemButton`, `Tooltip`, `HoverCard`, `Modal`, `RiskConfirmation`, `Toast`, `ShortcutKeys`, `SettingsForm`, `JsonTree`, `MarkdownText`, and the whole icon set. dshx's protocol-2 compatibility lists it as a **platform module** (`tooling/dshx/packages/dshx/src/compat/protocol-2.ts`), so a plugin import is always external and resolves to the Host's single copy, already themed. Only `queue-reorder` (icons, `Tooltip`) and `plugin-marketplace` (icons) use it today; every other plugin restyles the same controls by hand.
- Its runtime dependencies (`clsx`, `shiki`, `simple-icons`, …) are dev-only in the published package, so Node/Vitest cannot import it outside the Host. Plugin tests that render it substitute it (`plugin-marketplace/tests/MarketplaceTab.test.tsx`).
- The primitives do not cover: label/description/error field wiring, `textarea`, `select`, notices, empty states, section shells, confirmation dialogs with an arbitrary body, data tables, forms, async data state, or charts.
- dshx ships its own `useApiQuery` (connection-aware, no cache, no mutations, no invalidation). Every other plugin hand-rolls `useState` + `useEffect` loading/busy/error state around `useApi`.
- Ten owned UI packages contain 12 CSS Module files (~4.9k lines) and ~7.7k lines of TSX. `@dshfiles/project-folder-picker` is the precedent for a shared source package linked into another plugin (`secret-catalog`).
- BB handles this unevenly. `bb-plugins/plugins/mcp-manager/components/ui/` has local `Button`/`Input`/`Icon` built on Radix Slot + CVA + Tailwind; there is no cross-plugin BB UI package.
- shadcn's registry is a code-distribution system, not a runtime dependency. See [shadcn registries](https://ui.shadcn.com/docs/registry).

## Goal

Give DSH plugin authors one fast path to build plugin UI: Host primitives for atoms, one small `@dshfiles/plugin-ui` package for the gaps, and TanStack for data, tables, forms, and charts — then move every owned plugin onto it.

## What

Three layers, each owned once:

1. **Atoms — `@deepseek-ai/dsh-client-ui-primitives`.** Use the Host's `Button`, `Input`, `Checkbox`, `Switch`, `Tag`, `StateDot`, `Menu`, `Tooltip`, `Modal`, `SegmentedControl`, icons. Never restyle these locally.
2. **Gaps — `@dshfiles/plugin-ui`** (CSS Modules on `--dsw-*` tokens):
   - `Field` (label, description, error, `aria-describedby`/`aria-invalid` wiring through a render prop), `TextArea`, `Select`, `Notice`, `EmptyState`, `Section`, `ConfirmDialog` (over the Host `Modal` + `Button`), `VisuallyHidden`.
3. **Data/interaction — TanStack, exposed through `@dshfiles/plugin-ui` subpaths so the whole workspace pins one version:**
   - `@dshfiles/plugin-ui/query` — TanStack Query: a per-plugin `QueryClient`, `PluginQueryProvider`, and the full Query API re-exported.
   - `@dshfiles/plugin-ui/table` — TanStack Table v9: `DataTable` (semantic `<table>` with sortable headers) and the Table API re-exported.
   - `@dshfiles/plugin-ui/form` — TanStack Form: `useAppForm` from `createFormHook` with field components bound to `Field`/`Input`/`TextArea`/`Select`/`Checkbox`/`Switch`; validators are Standard Schema (zod 4).
   - `@dshfiles/plugin-ui/chart` — TanStack Charts: `ChartFrame` mapping the chart palette to DSH tokens, plus the used `Chart`, marks, and scales.

Keep page layout, domain workflows, revision graphs, sidebar behavior, and Host operations inside the owning plugin.

## Why

The same control families are restyled across ten packages while the Host already ships themed, accessible atoms that every plugin can import for free. Async state is hand-rolled in nine plugins, which is where loading, stale, retry, and double-submit bugs live. TanStack gives cache, mutation, and invalidation semantics (Query), headless sorting/filtering (Table), typed validated forms (Form), and accessible charts (Charts) without bringing a styling system, so it composes with DSH tokens instead of fighting them.

## How

### Conceptual model

```mermaid
flowchart LR
  Host[Host: dsh-client-ui-primitives<br/>platform module, external] --> Plugin
  Kit[@dshfiles/plugin-ui<br/>gap components + CSS Modules] --> Plugin
  TanStack[TanStack Query / Table / Form / Charts] --> Kit
  Plugin[Plugin client] --> Build[dshx build: one chunk,<br/>React + primitives external]
  Build --> Runtime[DSH Host]
```

### Operations / behavior

- Components are controlled through typed props; they own no plugin settings, network calls, or persistence.
- TanStack Query owns client-side async state. Query functions call the dshx `useApi` client and forward TanStack's `signal`. Mutations invalidate by key. One `QueryClient` per plugin bundle, so slots of one plugin share a cache and plugins never share one.
- Theme colors, borders, radii, and focus rings come from `--dsw-*` tokens. No global reset, no unscoped element selectors.
- React 18 is the target; every TanStack package declared supports it.

### Tech choices

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Atoms | `@deepseek-ai/dsh-client-ui-primitives` | Host-shared, already themed and accessible, zero bundle cost (platform module). |
| Gap components | Local `@dshfiles/plugin-ui` source package | Follows the `project-folder-picker` link pattern; one source of truth. |
| Server/async state | **TanStack Query 5** (`@tanstack/react-query`, React `^18 \|\| ^19`) | Cache, dedupe, mutations, invalidation, cancellation. Replaces hand-rolled `useEffect` loaders. |
| Tables | **TanStack Table 9** (`@tanstack/react-table`, React `>=18`) | Headless; markup and CSS stay ours. v9 API (`useTable`, `tableFeatures`), not v8. |
| Forms | **TanStack Form 1** (`@tanstack/react-form`, React `^17 \|\| ^18 \|\| ^19`) | Typed field state, Standard Schema validators (zod 4 already in the workspace). Used where a form has validation or more than a couple of fields; one-input forms stay `useState`. |
| Charts | **TanStack Charts 1** (`@tanstack/charts`, React adapter `@tanstack/charts/react`) | Typed grammar, accessible names/keyboard focus, CSS palette tokens map onto DSH variables. 1.0.0 shipped 2026-10-03, so it is pinned exactly and confined to `ai-accounts` until it has proven stable. No other ready chart library beats it on fit; Recharts/visx bring their own styling assumptions. |
| Virtualization | TanStack Virtual — deferred | No current list is long enough to need it; add with the first consumer. |
| shadcn/registries | Reviewed source and patterns only | Host primitives + TanStack cover the first cut; vendor an individual item only for a concrete gap (see research below). |
| Tailwind | Not used | Global stylesheet output and Host style leakage risk. |

### Architecture

`@dshfiles/plugin-ui` exports TSX source (like `project-folder-picker`). React and the Host primitives are peers, resolved external at build. TanStack packages are its `dependencies` and are re-exported from subpaths, so a plugin depends only on `@dshfiles/plugin-ui` and the workspace pins one TanStack version. dshx bundles the used TanStack code into each plugin's single chunk; subpaths keep Table/Form/Charts out of plugins that do not use them.

## Registry and component research

Reviewed the official shadcn component and registry documentation, focused community registry docs, BB plugin READMEs, and the user-provided Starboard `q=shadcn` results. The Starboard API returned 401, so its pasted result is the source for starred-repository discovery in this survey. Star counts and activity timestamps are discovery signals from that snapshot, not adoption criteria.

Official shadcn registries distribute source into a project and support GitHub-hosted registries; the CLI directory and registry health checks help discover and validate entries. Registry health measures availability/schema/installability, not component quality. Review item code, dependencies, registry dependencies, and target paths before installation. The `registry-template` and `alpine-registry` are examples if a first-party registry becomes useful; they are not needed to create the local package. See the [registry directory](https://ui.shadcn.com/docs/registry/registry-index), [GitHub registry guidance](https://ui.shadcn.com/docs/registry/github), and [registry health criteria](https://ui.shadcn.com/docs/registry/health).

### Components to review for the first library cut

| Component or pattern | Real use | Candidate source and decision |
|---|---|---|
| Button, icon button, field, input, textarea, select, checkbox, switch, badge, status, empty/loading state | Repeated in most owned DSH plugin clients and BB's MCP Manager | Make these the first small, theme-aware primitives. Compare the official [shadcn component set](https://ui.shadcn.com/docs/components) with [moduix's React CSS Modules track](https://moduix.dev/docs); copy only the selected source/patterns into `@dshfiles/plugin-ui`. |
| Dialog and confirmation dialog | Secret Catalog, MCP server management, marketplace actions, JJ operations | Review shadcn and moduix composition/focus behavior. Prefer native HTML for simple cases; add Ark/Radix only if the pilot demonstrates a real keyboard/focus gap. |
| Command menu and combobox | Settings Search, Marketplace, account/model chooser, project/path selection | The shadcn [Command](https://ui.shadcn.com/docs/components/radix/command) is designed for search and quick actions and is built on `cmdk`; check whether a smaller combobox covers existing needs before adopting the full command menu. |
| Tags input and multi-select | Future tokenized filters and multi-value metadata/config fields | Compare [Dice UI Tags Input](https://diceui.com/docs/components/radix/tags-input) with the Starboard finds [Emblor](https://github.com/JaleelB/emblor) and [shadcn multi-select](https://github.com/sersavan/shadcn-multi-select-component). Dice documents validation and sortable-tag composition; do not add a token editor until two DSH consumers need one. |
| Sortable list | Queue ordering and AI model ordering | [Dice UI Sortable](https://diceui.com/docs/components/radix/sortable) includes keyboard reorder/cancel interactions. Reuse only where the DSH/BB API provides a real ordering operation; the component must not simulate persistence. |
| Calendar/date range picker (deferred) | AI Accounts usage history and BB Tokitoki usage filters | Use the shadcn [date picker composition](https://ui.shadcn.com/docs/components/base/date-picker) as a source. It composes Popover + Calendar rather than imposing a date-range state model; keep range presets and query semantics in each plugin. |
| Semantic table and optional advanced data grid | Account history, server catalogs, and secret alias listings | **TanStack Table v9 via `DataTable`.** The shadcn [data-table guide](https://ui.shadcn.com/docs/components/base/data-table) explicitly treats table behavior as data-specific; evaluate [Dice UI Data Table](https://diceui.com/docs/components/base/data-table) or [Data Grid](https://diceui.com/docs/components/radix/data-grid) only when sorting, filtering, editing, virtualization, or keyboard cell navigation are actual requirements. |
| File upload | Possible future import, attachment, or document plugins | [Dice UI File Upload](https://diceui.com/docs/components/radix/file-upload) provides dropzone, validation, preview, and progress patterns. No current DSH/BB UI needs a shared uploader, so keep it out of the core cut. |

### Registry shortlist and disposition

| Registry/repository | Fit for this workspace | Plan |
|---|---|---|
| [shadcn/ui](https://github.com/shadcn-ui/ui) and its [official registry directory](https://ui.shadcn.com/docs/registry/registry-index) | Strong discovery and source catalog, but the normal Vite setup brings Tailwind and a global stylesheet. | Primary source of component ideas and selected copy-owned components. Do not copy its generated Tailwind setup into DSH by default. |
| [moduix](https://github.com/Blinks44/moduix) | Best styling-stack match found: React 18/19, Ark UI behavior, CSS Modules, local source registry, and no Tailwind requirement for that track. Its package also asks consumers to import shared foundation styles and an Ark peer; map its tokens and check CSS isolation before any use. | First technical comparison for complex primitives, with low adoption maturity treated as a risk. Check the actual source, MIT license, package peers, style entry points, build output, and DSH token mapping; do not adopt the full system by default. |
| [Dice UI](https://diceui.com/docs/components) | High-value specialty source for sortable controls, tags input, file upload, data table/grid, and key-value/status patterns. Components use Radix or Base UI and may bring focused dependencies. | Review individual items and dependencies; do not take the full catalog. Check React 18 support, accessibility, copied CSS, and the maintained source/license for each item. |
| [Kibo UI](https://www.kibo-ui.com/docs) | MIT shadcn registry with higher-level calendar, editor, upload, drag-and-drop, and AI patterns, generally styled with Tailwind utilities. | Use as a source for feature composition where relevant; lower priority for direct copying while the package standard is CSS Modules. |
| [ReUI](https://github.com/keenthemes/reui), [tablecn](https://github.com/sadmann7/tablecn), [COSS](https://github.com/cosscom/coss), and [awesome-shadcn-ui](https://github.com/birobirobiro/awesome-shadcn-ui) | Useful directories/pattern collections for data-heavy surfaces and finding additional registry entries; several assume Tailwind and a specific primitive stack. Other broad collections from the Starboard results include [shadcn-ui-expansions](https://github.com/hsuanyi-chou/shadcn-ui-expansions), [shadcn-extension](https://github.com/BelkacemYerfa/shadcn-extension), and [ui-x](https://github.com/junwen-k/ui-x). | Discovery and visual reference only until a concrete DSH plugin needs an advanced grid. Vet each item separately. |
| [shadcn/ui Registry Template](https://github.com/shadcn-ui/registry-template) and [Alpine Registry](https://github.com/shadcn-ui/alpine-registry) | Official example infrastructure for exposing copy-owned code through the shadcn CLI. | Keep on the developer-tooling watchlist. The local package remains canonical; start a registry only if it removes a real install/discovery bottleneck. |
| [@shadcn/lint](https://github.com/shadcn-ui/lint) and [shadcn/cn](https://github.com/shadcn-ui/cn) | Tailwind v4 tooling: design-token/class enforcement and class merge/conflict resolution. `@shadcn/lint` supports Oxlint. | Conditional on an explicit Tailwind-based plugin track. They do not improve a CSS Modules-only package by themselves. |

### Current plugin fit

| Plugin | First useful shared pieces | Preserve as plugin-owned |
|---|---|---|
| `ai-accounts` | Search/combobox for accounts and models, checkbox/switch, badges/status, sortable model rows, date range controls, basic chart frame/legend patterns | Account/provider semantics, quota aggregation, persisted preferences, and chart data/interaction rules |
| `jujutsu` | Buttons, confirmation dialog, search/select, status and empty states, file-list/tree primitives if a second consumer appears | Revision graph, diff semantics, workspace operations, and JJ-specific context menus |
| `mcp-servers` | Form fields, switches, transport combobox, key/value row pattern, validation/help/error, status and confirmation dialog | Host operations, OAuth, process lifecycle, endpoint catalog, and secret redaction/reveal rules |
| `multi-host` | Status/badge, fields, select, confirmation dialog, loading/error/empty state | Connector state, connection workflow, host identity, and transport semantics |
| `plugin-marketplace` | Search/combobox, filter controls, badge, card, empty/loading state, confirmation dialog | Marketplace query model, install/update actions, package metadata, and card composition |
| `project-folder-picker` | Reuse field, command/combobox, list item, empty state, dialog/popover primitives | Its specialized injected operations, path/workspace identity, browsing, and keyboard navigation contract |
| `queue-reorder` | Sortable handle/list interaction and shared button/status styles | Queue ordering rules and the Host API call; adopt sortable UI only if the public operation supports it |
| `secret-catalog` | Field, search/combobox, table rows, badge/status, button, dialog/confirmation | Value-free alias metadata, deliberate reveal/copy flow, and secret-operation boundary |
| `settings-search` | Compact Command/combobox, result row, empty state, keyboard/focus styles | Settings index and navigation/focus behavior owned by the plugin/Host APIs |
| `thread-sidebar` | Buttons, badges, filters/selects, empty/loading state, and confirmation dialog | Session/workspace grouping, archive/restore lifecycle, and sidebar-specific layout |

The first pilot remains `project-folder-picker` + `secret-catalog`; it exercises a specialized searchable picker and a stateful catalog/dialog while keeping all Host operations injected. Add the data-grid, sortable, tag-entry, and date-range patterns only when the named consumer proves a repeated interaction.

### BB plugin fit

BB contributes useful demand examples, but its plugin runtime/API and UI ownership are separate from DSH. Keep the new package DSH-scoped until a separate compatibility check proves a safe shared package contract.

| BB plugin | Useful component/library signal | Boundary to retain |
|---|---|---|
| MCP Manager | Local Button/Input/Icon already exist; provider catalogue search, server forms, field arrays, status, and confirmation patterns overlap with DSH MCP Servers. | Keep BB RPC, OAuth, process management, and credential-handling code in BB. Reuse patterns/source only; do not copy BB-specific API assumptions. |
| AI Accounts and Tokitoki Usage | Searchable account/model pickers, checkboxes, order controls, date filters, quota status, popovers, and time-series charts reinforce the DSH AI Accounts candidates. | BB storage/provider facts and quota semantics remain plugin-owned. |
| Secret Catalog | Buttons, fields, search, alias tables, status, and confirm/reveal affordances match DSH Secret Catalog. | Preserve value-free listing and explicit ephemeral reveal/copy boundaries. |
| Settings Search | Compact search/combobox with result categories and focus-on-selection. | This is a content-script decoration; a React component cannot be imported directly into that surface. Only share design tokens or a compatible DOM implementation if a BB package is later approved. |
| Jujutsu and Diff Viewed | Project/path picker, action buttons, checkboxes, progress, and empty/status treatments are reusable patterns. | The JJ graph/diff and Diff Viewed's BB-owned DOM/content-script hooks stay specialized. |
| Remaining BB plugins | Shared notices, buttons, and settings controls may apply if a second concrete caller is found. | Do not create abstractions for thin or non-UI plugins solely to increase adoption count. |

### Future watchlist

These are possible feature sources, not first-cut dependencies:

- [AI Elements](https://elements.ai-sdk.dev/docs) and [assistant-ui](https://github.com/assistant-ui/assistant-ui) for a future plugin that embeds an AI conversation, reasoning, tool approval, or agent-status view. AI Elements is distributed as source and documents AI SDK usage; DSH owns its native conversation UI, so only use isolated pieces if a plugin has a distinct embedded-chat need.
- [Plate](https://github.com/udecode/plate) for a future rich-text, knowledge, prompt, or document-authoring plugin. It is a full editor ecosystem, not a general form control.
- [pdfcn](https://github.com/shadcn-labs/pdfcn) for a future PDF preview/export plugin; [emailcn](https://github.com/shadcn-labs/emailcn) or [Maily](https://github.com/arikchakma/maily.to) only if a plugin gains email composition.
- [Dither Kit](https://github.com/Boring-Software-Inc/dither-kit) and [EvilCharts](https://github.com/legions-developer/evilcharts) for chart patterns in usage dashboards. Dither Kit currently requires Tailwind plus Motion/D3 dependencies; compare accessibility, tooltip and range behavior against existing custom charts before considering it.
- [Loora](https://github.com/lassejlv/loora) is a separate agent-editable design canvas with MCP and React/HTML export, so it could be explored as a prototyping workflow. Its AGPL-3.0 license and full-service footprint need review; it is not a component source or package dependency.
- [shadcn-html](https://github.com/codylindley/shadcn-html) is a semantic HTML/CSS/vanilla-JS prototyping substrate; borrow token and markup ideas for quick sketches, not the React plugin package.
- [Magic UI](https://github.com/magicuidesign/magicui), [Cult UI](https://github.com/nolly-studio/cult-ui), [8bitcn](https://github.com/TheOrcDev/8bitcn-ui), and [Canvas UI](https://github.com/DavidHDev/canvas-ui) are visual/motion inspiration. Keep animation-heavy, WebGL, and novelty styles out of the base control kit unless a specific plugin calls for them.
- React Native Reusables, Tauri starters, Solid-only kits, and terminal registries such as TermCN/TUIParts target other runtimes or scaffolding needs; revisit only for a native/CLI plugin-authoring path.

## What this allows

- Build forms, dialogs, tables, notices, and empty states from existing parts in minutes.
- Replace hand-rolled loading/busy/error state with Query and mutations.
- Fix accessibility and theme behavior once.
- Add an external registry component selectively without inheriting its app setup.

## What this does not allow

- It does not replace DSH slots, settings APIs, or Host capabilities.
- It does not standardize whole plugin pages.
- It does not add remote component loading, a second React copy, global CSS resets, or React 19-only components.
- It does not justify rewriting revision graphs, sidebar behavior, or domain editors as generic primitives.

## UI & UX

No standalone screen. Effects appear in the plugin surfaces that adopt it.

| Action | Result |
|--------|--------|
| Tab to a control | Visible focus ring from the DSH theme. |
| Use a disabled control | Native disabled semantics; cannot activate. |
| Open a dialog | Host `Modal` layering: focus enters, Escape closes, focus returns. |
| Submit an invalid field | Error is rendered under the field and linked with `aria-describedby` + `aria-invalid`. |
| Sort a table column | Header button toggles sort and exposes `aria-sort`. |

## Data model

None. Stateless UI; persisted data stays in each plugin's Host half.

## Implementation steps

1. ✅ Audit: Host primitives, dshx platform modules, `useApiQuery`, theme tokens, per-plugin control inventory.
2. ✅ Build `@dshfiles/plugin-ui`: gap components, `/query`, `/table`, `/form`, `/chart`, a shared Host-primitives test double, README.
3. ✅ Pilot `project-folder-picker` + `secret-catalog`, then migrate `ai-accounts`, `jujutsu`, `mcp-servers`, `plugin-marketplace`, `queue-reorder`, `settings-search`, `thread-sidebar`. One jj revision per plugin.
4. ✅ Verify: workspace typecheck/test/build; every client bundle keeps React and the primitives external; per-plugin isolated boot (`tooling/dshx/scripts/boot-check-web.mjs`).
5. ⏭ Not migrated: `shortcuts`, `agent-communication`, `goal-stall-guard` have no UI. `multi-host` lives as uncommitted work in another checkout; migrate it when it lands.
6. ⏭ BB: kept separate. BB's runtime and content-script surfaces cannot consume DSH's platform module; BB stays a source of usage evidence.

## Results

| Plugin | CSS lines before → after | Query | Table | Form | Charts | Tests before → after |
|---|---|---|---|---|---|---|
| ai-accounts | 1452 → 716 | ✅ one cache for 4 slots, replaces 4 polls | ✅ banked resets | ✅ account editor | ✅ quota history | 68 → 74 |
| jujutsu | 596 → 439 | ✅ load/details/diff + prepare/confirm | — | — | — | 12 → 12 |
| mcp-servers | 422 → 298 (`client.tsx` 850 → 56) | ✅ snapshot + actions | — | ✅ server editor | — | 19 → 22 |
| plugin-marketplace | 449 → 232 | ✅ infinite catalog + install | — | — | — | 29 → 29 |
| secret-catalog | 376 → 136 | ✅ list/machine + mutations | ✅ aliases | ✅ create/edit | — | 24 → 34 |
| project-folder-picker | 201 → 128 | — | — | — | — | 3 → 3 |
| settings-search | 186 → 120 | ✅ save/reset mutation | — | — | — | 10 → 10 |
| thread-sidebar | 1015 → 803 | — (sync stores) | — | — | — | 17 → 17 |
| queue-reorder | 231 → 224 | ✅ queue writes | — | — | — | 5 → 5 |

Total across the migration: ~7.0k lines removed, ~5.3k added (plugin-ui included). Client bundles are unminified (dshx sets `minify: false`); TanStack adds ~120 KB (Query) to ~1 MB (ai-accounts, all four libraries) per plugin, loaded from localhost.

### Kept local, by reason

- **Matches a Host reference surface.** `queue-reorder` dock buttons and editor (shipped dock styling differs from Host `Button`); `thread-sidebar` rail/row/header metrics, row icon buttons, header-style radios, the "More" footer popover.
- **List rows, not actions.** Picker, settings-search results, jujutsu revisions, ai-accounts rail rows stay `<button>` rows: the Host `Button` has a fixed control height.
- **Domain visuals.** Revision graph, diff blocks, quota bars, provider marks, marketplace/server/catalog cards, the draggable edge widget, the secret mask/reveal block.
- **Security.** Secret reveal stays outside Query so a value never sits in a cache.
- **No primitive exists.** `<details>`, `<datalist>`, spinners, links.

### Behaviour changes worth a look

1. ai-accounts: the rail switch toggled twice and saved nothing — fixed. Model curation now marks the editor dirty. Profile removal asks first. Slug validation enforces the documented pattern.
2. secret-catalog: item type is always sent (it showed "Login" but sent nothing). Old rows are not kept while another folder loads, so actions cannot target the wrong folder.
3. thread-sidebar: park/unpark use the Host pause/play icons. The context menu lost its accessible name (Host `Menu` has no label prop).
4. jujutsu: sticky offsets were tuned for the old header; check them visually.
5. Wide dialogs (mcp-servers manager, secret-catalog) size the Host `Modal` via `className`, which relies on plugin CSS loading after Host CSS.

### Follow-ups

1. Interactive component tests: most plugins lack `jsdom` + `@testing-library/react`. The shared double (`plugin-ui/testing/host-primitives.tsx`) is ready; first targets are "removal never fires before confirmation" in secret-catalog and mcp-servers.
2. Host gaps: `Menu` label prop, `Tag` attribute pass-through, a danger `Button` variant, a disclosure primitive.
3. Consider enabling minification in dshx client builds.

## Open questions

1. ~~moduix vs own primitives~~ — resolved: the Host primitives cover the atoms; moduix is not adopted.
2. ~~Ark/Radix for dialogs~~ — resolved: Host `Modal` covers focus, Escape, layering, and shortcut scope.
3. BB consumption — still separate; revisit only if BB gains a compatible shared runtime.
4. TanStack Charts maturity — re-evaluate after a few releases before using it beyond `ai-accounts`.

## Acceptance criteria

- [x] `@dshfiles/plugin-ui` typechecks and tests independently.
- [x] Every migrated plugin typechecks, tests, and builds; client bundles keep React and `dsh-client-ui-primitives` external.
- [x] Shared styles are CSS Modules on `--dsw-*` tokens with no global reset or unscoped element rule.
- [x] Controls keep accessible names, label/error association, focus visibility, disabled semantics, and Host dialog behavior.
- [x] Hand-rolled async loaders in migrated plugins use TanStack Query; remaining local primitives have a recorded reason (above).
- [x] Isolated per-plugin boot (`boot-check-web.mjs`, scratch DSH_HOME, port 0): all 11 bundles reach active and mount.
- [ ] Visual pass in the user's browser on a second instance (never restart the live web profile).

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-05 | Use a local `@dshfiles/plugin-ui` package as the shared API | Existing linked React package demonstrates the pattern. |
| 2026-10-05 | Use shadcn and community registries as reviewed source, not runtime dependencies | Vendoring preserves licensing, React 18 compatibility, CSS scope. |
| 2026-10-05 | CSS Modules and DSH theme tokens, no Tailwind | Fits client builds; avoids app-level stylesheets. |
| 2026-10-05 | Add moduix, Dice UI, Kibo UI, and official shadcn entries to the candidate survey | Broadened source coverage; none is an unconditional dependency. |
| 2026-10-05 | Keep BB as a separate compatibility review | BB plugin APIs/build ownership differ. |
| 2026-10-05 | Build on `@deepseek-ai/dsh-client-ui-primitives` for atoms | Host-shared platform module, themed, accessible, zero bundle cost; supersedes vendoring Button/Input/Checkbox/Switch/Dialog from registries. |
| 2026-10-05 | Prefer TanStack: Query, Table, Form, Charts | User preference; headless libraries compose with DSH tokens. React 18 verified against each published peer range. |
| 2026-10-05 | Re-export TanStack from `@dshfiles/plugin-ui` subpaths | One pinned version across plugins; plugins declare one dependency. |
| 2026-10-05 | Pin TanStack Charts exactly and confine to `ai-accounts` | 1.0.0 is two days old. |
| 2026-10-05 | Keep dshx `useApiQuery` but stop using it in owned plugins | Toolchain API stays for other authors; TanStack Query supersedes it here. |
| 2026-10-05 | Use Query even for a lone mutation (queue-reorder, settings-search) | Consistency with the TanStack preference; the unminified bundle cost is served from localhost. |
| 2026-10-05 | Keep Host-reference surfaces local where the primitives do not match | Fidelity to the shipped dock and sidebar outranks shared styling. |
