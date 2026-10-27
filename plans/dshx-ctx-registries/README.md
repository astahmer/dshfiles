# dshx: opencode-style plugin context

Port the best ideas of opencode v2's GUI plugin SDK into `@dshfiles/dshx/client`,
additively: every existing API (`defineClient`, `defineSlot`, `defineClientPlugin`,
`uses`) keeps working.

Resume here: integrate the settings-entries and dialogs workspaces, point the
`SettingsSection` registry at the settings search seat, then run the closing checks.

| # | Item | Revision | Status |
|---|------|----------|--------|
| 1 | `add(registry, item \| track => item)` + typed native registries | `feat(dshx): give client plugins a shared context…` | done |
| 2 | `defineContract` / `defineRegistry`, `Live<T>`, `bind` | same | done |
| 3 | `dialogs` / `toast` / `layout` / `commands.run` | same | done (provider: dialogs plugin) |
| 4 | `defineStore` global/session/project, `from` | same | done |
| 5 | `keyed`, `signal`, `useKeyed`, `useLatest` | same | done |
| 6 | `defineLocale` English fallback + `plural` | `feat(dshx): let locales fall back to English…` | done |
| 7 | Settings search entries + `target` | settings-entries workspace | in progress |
| 8 | `dshx add <pkg>` | `feat(dshx): install a plugin into a profile in one step` | done |
| 9 | Failure isolation + Plugins page report | core + `feat(plugin-marketplace): show a plugin's failed contributions…` | done |
| — | `Command` owners: shortcuts binds keys, palette lists | `feat(shortcuts)…`, `feat(command-palette)…` | done |
| — | `@dshfiles/dialogs` provider | dialogs workspace | in progress |

## Design

- One versioned page broker (`globalThis.__dshxBrokerV1`) keyed by token id. Tokens hold
  kind + id only, so other plugins import them without runtime code.
- Providers and registrations are tied to the Cordis fiber scope.
- `Live<T>`: `pending`, `active` (`value`, `generation`, `owner`), `inactive` (`disabled`, `failed`).
- Item functions take `track(source)`; a tracked change recomputes the item (microtask-coalesced).
- dshx renders native-slot registries itself; owned plugins own the rest (`Command`).
- React is touched lazily (context, error boundary): bundles evaluate before the Host hands them React.
- The bundled `@dshfiles/dshx/client` is a hand-listed virtual module;
  `tests/client-public-exports.spec.ts` keeps it in sync with `src/client/index.ts`.

## Follow-ups

- Migrate ad hoc window globals (`__dshfilesCommandPaletteV1`, chat-focus, draft-client) to dshx contracts/registries.
- Contribution failures are browser-only; an agent tool would need a Host relay.
