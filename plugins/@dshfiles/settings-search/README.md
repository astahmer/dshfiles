# Settings Search

DSH 0.2 settings search indexes the redacted `ConfigForms.describe()` schema
mirror and returns stable `{ entryId, fieldPath }` identities. Search matches
field labels, descriptions, owning entry, ancestor section labels, and finite
option labels and values; letter accents are ignored. The search field focuses
when its Settings section opens. With an empty query it shows available
settings categories, using schema titles when present; choosing one browses
that entry's searchable fields. Secret paths and their descendants are
excluded.

Selecting a result first asks the Settings shell for a native owner of that exact `{ entryId, fieldPath }` target. When one is registered, the shell opens its normal section and row; the owner focuses its native control. Otherwise, the plugin opens a typed editor backed by `ctx.configForms.get(entryId)`. The fallback reads the current Host-backed snapshot, writes a typed path operation with the snapshot revision, and can remove a user override to restore the inherited value. Finite schema choices remain selects, booleans remain switches, and strings use single-line inputs. It edits the real settings entry instead of creating a second stored form.

## Navigation search

The plugin also occupies the Settings title seat (`settings.header`, shadowed at
priority -1) with a compact search field above the section navigation. Results
are ranked (title, then section, then description and options), listed inline
under the field, and focus on open. The shell opens a native owner when one
advertises the exact target; unsupported or ambiguous targets use the same
revision-guarded editor fallback. The **settings-search** Settings entry
controls whether the field shows, whether it takes focus when Settings opens,
and how many results it lists.

## Native owner routing

The Client `ui-settings` package provides `ctx.settingsTargets`. A feature
registers `{ entryId, fieldPath, sectionId, ownerId }` for each native control
and withdraws the route with that row's slot registration. The shell resolves
only one exact live match, selects its section, and passes the target to the
owning section; the General section renders only that owner row. The row owns
finding and focusing its control. Unknown or ambiguous targets return `false`
so Settings Search keeps the live Host-backed typed editor. This path uses slot
ownership, not DOM selectors or duplicated setting data.

Older Settings shells do not provide the optional target callback. The plugin
keeps the typed fallback for those runtimes, including referenced schema choices
from the full search result.

## Marketplace decision and compatibility

The marketplace candidate `@objectivex666/dsh-settings-search` was audited
against its package manifest and shipped client. Its manifest declares no DSH
peer range and injects `@deepseek-ai/dsh-client-runtime`, which is absent from
the installed rc.2 tree. Its client indexes slot registrations plus rendered
DOM and navigates by clicking sidebar buttons and highlighting matching rows;
there is no rc.2 section-owner API for that direct jump. The candidate was not
adopted or ported; this package is built with the local `@dshfiles/dshx` fork
and the installed rc.2 `ConfigForms`/slot APIs.

The optional target callback is a Client Settings contract; older rc.2 shells
remain compatible and use the typed editor fallback. The plugin owns one
`settings.section` contribution. The parent composition must add
`@dshfiles/settings-search` and its package dependency; root manifests and
profile composition are intentionally not changed here.
