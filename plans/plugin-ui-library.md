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
2. Survey the current shadcn registry and relevant public entries. Keep a short candidate list with license, source revision, React version, dependencies, CSS model, accessibility notes, and why each item beats a local implementation. Reject entries that need broad global styling or carry unnecessary dependencies.
3. Define and build the `@dshfiles/plugin-ui` package contract, CSS Module conventions, DSH token mapping, and focused component coverage. Keep any necessary registry provenance in the package.
4. Pilot with `project-folder-picker` and `secret-catalog`: share button, field, and dialog primitives while preserving their injected operations and workflow-specific presentation. Build both clients to prove linked TSX and CSS bundle correctly.
5. Migrate matching primitives in `ai-accounts`, `jujutsu`, `mcp-servers`, `multi-host`, `plugin-marketplace`, `queue-reorder`, `settings-search`, and `thread-sidebar`. Keep feature layouts and controls that intentionally match a Host surface local; record each exception.
6. Split implementation into focused JJ revisions: package/API, pilot migration, then small plugin migration batches. Run focused package and consumer checks after each batch; compare shared-control CSS before and after the pilot.
7. Verify light and dark themes, narrow panels, keyboard/focus behavior, and CSS isolation in a scratch/probe instance or second DSH port. Never restart the active web profile for this work.
8. Document installation/linking, component props, examples, accessibility guarantees, adding a component, registry provenance, and the tested DSH/React range.

## Open questions

1. Which individual registry entries survive the license, React 18, dependency, accessibility, and CSS review? Decide this during the initial source survey; no registry item is required for the first package API.
2. Do existing dialogs need a Radix-based primitive, or can native elements and the current React APIs cover required focus behavior? Let the pilot's accessibility and runtime checks answer this before adding a dependency.

## Acceptance criteria

- [ ] `@dshfiles/plugin-ui` builds independently and from at least three real plugin consumers without a runtime import of the shared package or a duplicate React identity.
- [ ] At least three shared primitives are used by at least three plugin packages; the pilot records a before/after count of duplicated shared-control rules and source lines.
- [ ] Shared styles use CSS Modules and DSH theme tokens, work in light/dark themes and narrow panels, and contain no global reset or unscoped element rules.
- [ ] Controls preserve accessible names, labels, error associations, focus visibility, disabled semantics, and dialog keyboard/focus behavior.
- [ ] Existing UI packages use shared components for matching primitives; remaining local primitive styles have a documented semantic or Host-integration reason.
- [ ] A scratch/probe runtime boot has no activation failures and shows the pilot controls without changing unrelated Host/plugin styles.
- [ ] Every adopted upstream component has its source and license recorded; no runtime registry access is required.

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-05 | Use a local `@dshfiles/plugin-ui` package as the shared API | Existing local linked React package demonstrates the repository pattern; a standalone package keeps reusable UI independent of each plugin's domain. |
| 2026-10-05 | Use shadcn and community registries as reviewed source, not runtime dependencies | Registry code can speed discovery, while vendoring preserves licensing, React 18 compatibility, CSS scope, and plugin build ownership. |
| 2026-10-05 | Start with CSS Modules and DSH theme tokens | Fits current client builds and avoids making Tailwind's app-level stylesheet part of every plugin by default. |
