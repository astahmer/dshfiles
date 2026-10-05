# Plugin UI library plan

## Context

- DSH plugin clients are React 18 apps built through dshx's Vite pipeline, which already handles CSS Modules, Tailwind, and ordinary CSS imports. See [the dshx SDK guide](../tooling/dshx/docs/sdk/getting-started.md).
- Ten owned UI packages currently contain 12 CSS Module files. Buttons, fields, form labels, status treatments, empty states, and dialog controls are styled locally. For example, `multi-host` defines its own input and button system, while `secret-catalog` separately styles its catalog controls and mutation dialog.
- There is no general-purpose shared DSH plugin UI package. `@dshfiles/project-folder-picker` is a useful precedent: an isolated React package with injected operations, imported by `secret-catalog` through a local workspace link. It is a specialized picker, not a primitive library.
- BB handles this unevenly too. `bb-plugins/plugins/mcp-manager/components/ui/` contains local `Button`, `Input`, and `Icon` components; `Button` uses Radix Slot and class-variance-authority with Tailwind utility classes. I found no cross-plugin BB UI package; other plugin surfaces keep their own CSS and markup. This is a useful source of ideas, not a DSH integration contract.
- shadcn's registry is a code-distribution system, not a runtime component dependency. Its standard Vite setup configures Tailwind and imports its stylesheet; selected source can be adapted, but the generated setup should not be copied into DSH without checking how its CSS interacts with the Host. See [shadcn registries](https://ui.shadcn.com/docs/registry), [Vite installation](https://ui.shadcn.com/docs/installation/vite), and the [registry directory](https://ui.shadcn.com/docs/registry/registry-index).

## Goal

Give DSH plugin authors one small, accessible, theme-aware component package so new plugin UI can be assembled quickly and existing plugins can stop restyling the same controls.

## What

Create an internal package, provisionally `@dshfiles/plugin-ui`, for React UI primitives and repeated small patterns. Plugins import from this local package; dshx bundles the used source into each plugin client.

Start with the pieces already repeated in current plugins:

- Buttons with primary, secondary, quiet, and destructive variants; icon buttons require an accessible name.
- Form labels, descriptions, errors, text inputs, textareas, selects, checkboxes, and switches.
- Badges, status indicators, section/card shells, empty states, and inline notices.
- Dialog and confirmation-dialog shells, including keyboard and focus behavior.

Keep page layout, domain forms, tables, charts, menus unique to one workflow, data state, and Host operations inside the owning plugin. Add a shared primitive only after at least two real consumers need the same behavior.

Review shadcn/ui and relevant public registry entries as source material. Vendor only selected components after checking their license, React 18 compatibility, dependencies, accessibility behavior, and CSS assumptions. Record each adopted source and license. The local package remains the maintained source of truth; plugin startup must not fetch registry content.

## Why

The source inventory shows the same basic control families reimplemented across ten packages. That costs time on every new UI and lets focus, disabled, spacing, and theme behavior drift. A small shared package can reduce both repeated CSS and the amount of setup needed to build a plugin. The specialized folder picker already proves this repository can link a reusable React package into another plugin.

## How

### Conceptual model

```mermaid
flowchart LR
  Registry[Reviewed registry source] --> Adapted[Adapted React 18 components]
  Adapted --> Kit[@dshfiles/plugin-ui<br/>TSX + CSS Modules + DSH theme tokens]
  Kit --> Plugin[Plugin imports local package]
  Plugin --> Build[dshx Vite client build]
  Build --> Host[DSH Host]
```

### Operations / behavior

- Components are controlled through typed props and callbacks; they do not own plugin settings, network calls, persistence, or domain state.
- Shared CSS Modules style the shared primitives. Feature CSS continues to own page composition and genuinely unique visuals.
- Theme colors, borders, radii, focus rings, and surfaces come from supported DSH theme tokens. Do not introduce a package-wide hard-coded palette.
- Treat web/React 18 as the supported target until the DSH runtime changes. Keep the library free of DSH service imports so it can be built and reviewed independently.

### Tech choices

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Shared distribution | Local `@dshfiles/plugin-ui` workspace package | Follows the existing `project-folder-picker` package-link pattern and gives one source of truth across plugins. |
| Upstream components | Curated shadcn/community registry source, adapted and vendored | Registries make useful code easy to discover; vendoring keeps source, licensing, versions, and dependencies reviewable. |
| Styling | CSS Modules using DSH theme tokens | Matches current plugin styles and limits selector scope. Do not add an unscoped reset or host-wide theme. |
| Tailwind | Not required by the shared package | dshx supports it, but shadcn's normal Vite setup brings Tailwind configuration and stylesheet output. Test any Tailwind-derived source for Host style leakage before adoption. |
| Behavioral primitives | Native HTML first; add a focused accessible primitive dependency only when needed | Avoid adding Radix or other packages for simple styling. Any dependency must pass React 18 and bundle checks. |

### Architecture

`@dshfiles/plugin-ui` has a public component contract, React as its only UI peer, and no DSH peer dependencies. Consumer plugins link the local source package as they do with `project-folder-picker`. The client build must inline imported library code and styles so the running Host does not need to resolve a new shared runtime package.

Keep upstream provenance beside the component or in a package registry/source catalog: source URL, license, source revision, local changes, and required dependencies. Do not rely on a remote registry during build or plugin startup.

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
| Calendar/date range picker | AI Accounts usage history and BB Tokitoki usage filters | Use the shadcn [date picker composition](https://ui.shadcn.com/docs/components/base/date-picker) as a source. It composes Popover + Calendar rather than imposing a date-range state model; keep range presets and query semantics in each plugin. |
| Semantic table and optional advanced data grid | Account history, server catalogs, and secret alias listings | Start with semantic table primitives. The shadcn [data-table guide](https://ui.shadcn.com/docs/components/base/data-table) explicitly treats table behavior as data-specific; evaluate [Dice UI Data Table](https://diceui.com/docs/components/base/data-table) or [Data Grid](https://diceui.com/docs/components/radix/data-grid) only when sorting, filtering, editing, virtualization, or keyboard cell navigation are actual requirements. |
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

- Build common forms, dialogs, status rows, and empty states from existing components.
- Fix accessibility and theme behavior once and carry the fix to every consumer.
- Add external registry components selectively without inheriting their whole app setup.
- Keep plugin-specific composition and interaction ownership clear.

## What this does not allow

- It does not replace DSH slots, settings APIs, native controls, or Host capabilities.
- It does not standardize whole plugin pages or force every surface into one visual layout.
- It does not add remote component loading, a second React copy, global CSS resets, or React 19-only components.
- It does not justify rewriting unique charts, revision graphs, sidebar behavior, or domain-specific editors as generic primitives.

## UI & UX

This package has no standalone screen. Its effects appear in the plugin surfaces that adopt it.

### Desktop

Controls retain compact DSH sizing and support explicit variants. Inputs show label, help, and error states. Dialogs keep predictable width, scrolling, keyboard dismissal, and focus restoration.

### Mobile

Components size to their containing plugin surface, wrap labels and button groups, and avoid fixed widths. This is responsive behavior for narrow Host panels, not a separate mobile design.

### Common interactions

| Action | Result |
|--------|--------|
| Tab to a control | Visible focus indicator follows the active DSH theme. |
| Use a disabled control | It cannot activate and exposes native disabled semantics. |
| Open a dialog | Focus enters the dialog; Escape closes when allowed; focus returns to the trigger. |
| Use an icon-only button | It has a required accessible label and the same focus/disabled behavior as other buttons. |
| Submit an invalid field | The caller supplies the error; the field associates it with the input for assistive technology. |

## Data model

None. This is a stateless UI package; all persisted data and workflow state remain in consuming plugins.

## Implementation steps

1. Audit current DSH client exports, supported theme tokens, React version, and marketplace options. Count concrete duplicate controls and verify which Host APIs or native UI already cover a proposed component.
2. Compare the moduix React CSS Modules components with shadcn's source for Button/Field/Dialog/Command/Popover/Calendar and review Dice UI's Tags Input, Sortable, Table/Grid, and File Upload individually. Use Kibo/ReUI/TableCN as patterns for higher-level features. For each candidate, record license, pinned source revision, React 18 range, runtime/peer dependencies, global and module CSS, accessibility behavior, bundle impact, and adaptation needed for DSH tokens.
3. Select only components that solve two real DSH use cases or one complex interaction that is expensive to implement accessibly. Keep simple native HTML controls local to the package and defer advanced grid, editor, upload, chart, and animation features until a consumer needs them.
4. Define and build the `@dshfiles/plugin-ui` package contract, CSS Module conventions, DSH token mapping, and focused component coverage. Keep any necessary registry provenance in the package; do not require a hosted registry or runtime fetch.
5. Pilot with `project-folder-picker` and `secret-catalog`: share button, field, search/list, and dialog primitives while preserving injected operations, secret boundaries, and workflow-specific presentation. Build both clients to prove linked TSX and CSS bundle correctly.
6. Migrate matching primitives in `ai-accounts`, `jujutsu`, `mcp-servers`, `multi-host`, `plugin-marketplace`, `queue-reorder`, `settings-search`, and `thread-sidebar`. Keep feature layouts and controls that intentionally match a Host surface local; record each exception. Use sortable/date-range/table components only in the mapped consumers and after confirming the underlying Host APIs support the behavior.
7. Review BB consumers separately. Decide whether their runtime/build supports a DSH package without duplicate React, CSS, or Host coupling before proposing any BB migration; otherwise keep BB as a source of usage evidence and patterns.
8. Split implementation into focused JJ revisions: package/API, pilot migration, then small plugin migration batches. Run focused package and consumer checks after each batch; compare shared-control CSS before and after the pilot.
9. Verify light and dark themes, narrow panels, keyboard/focus behavior, CSS isolation in a scratch/probe instance or second DSH port, and any adopted registry component's peer identity/bundle. Never restart the active web profile for this work.
10. Document installation/linking, component props, examples, accessibility guarantees, adding a component, source/license/revision provenance, and the tested DSH/React range.

## Open questions

1. Does moduix's CSS Modules track map cleanly onto DSH theme tokens without leaking foundation styles across plugin surfaces, or should the kit own small primitives and borrow only its Ark interaction patterns?
2. Which individual shadcn/Dice/Kibo entries survive license, React 18, dependency, accessibility, CSS, and build review? No registry item is required for the first package API.
3. Do the DSH dialog consumers need Ark/Radix behavior after the pilot, or can native elements and the current React APIs cover focus, dismissal, and restoration?
4. Should a later phase make the package consumable by BB plugins, or keep independent libraries because the two plugin runtimes have different host contracts?

## Acceptance criteria

- [ ] `@dshfiles/plugin-ui` builds independently and from at least three real plugin consumers without a runtime import of the shared package or a duplicate React identity.
- [ ] At least three shared primitives are used by at least three plugin packages; the pilot records a before/after count of duplicated shared-control rules and source lines.
- [ ] Shared styles use CSS Modules and DSH theme tokens, work in light/dark themes and narrow panels, and contain no global reset or unscoped element rules.
- [ ] Controls preserve accessible names, labels, error associations, focus visibility, disabled semantics, and dialog keyboard/focus behavior.
- [ ] Existing UI packages use shared components for matching primitives; remaining local primitive styles have a documented semantic or Host-integration reason.
- [ ] A scratch/probe runtime boot has no activation failures and shows the pilot controls without changing unrelated Host/plugin styles.
- [ ] Every adopted upstream component has its source URL, license, pinned source revision, changes, and dependencies recorded; no runtime registry access is required.
- [ ] Search, reorder, date-range, and advanced table patterns are adopted only by mapped consumers with real product needs and a supported Host operation; BB reuse remains separately compatibility-gated.

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-05 | Use a local `@dshfiles/plugin-ui` package as the shared API | Existing local linked React package demonstrates the repository pattern; a standalone package keeps reusable UI independent of each plugin's domain. |
| 2026-10-05 | Use shadcn and community registries as reviewed source, not runtime dependencies | Registry code can speed discovery, while vendoring preserves licensing, React 18 compatibility, CSS scope, and plugin build ownership. |
| 2026-10-05 | Start with CSS Modules and DSH theme tokens | Fits current client builds and avoids making Tailwind's app-level stylesheet part of every plugin by default. |
| 2026-10-05 | Add moduix CSS Modules, Dice UI, Kibo UI, and official shadcn entries to the candidate survey | Moduix is the closest styling/runtime fit found; Dice UI has specific interactions with current callers; Kibo and the official registry broaden source coverage. None is an unconditional dependency. |
| 2026-10-05 | Map component sources to DSH and BB plugin behavior before migration | Keeps advanced interactions tied to real screens and preserves DSH Host, BB Host, secret, file-system, and ordering boundaries. |
| 2026-10-05 | Keep BB as a separate compatibility review | BB plugin APIs/build ownership differ; the DSH package is not a BB runtime dependency until that contract is verified. |
