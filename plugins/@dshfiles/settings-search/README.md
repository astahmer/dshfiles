# Settings Search

DSH 0.2 settings search indexes the redacted `ConfigForms.describe()` schema
mirror and returns stable `{ entryId, fieldPath }` identities. Search matches
field labels, descriptions, owning entry, and ancestor section labels. With an
empty query it shows the available settings entries; choosing one browses that
entry's searchable fields. Secret paths and their descendants are excluded.

Selecting a result opens a focused editor backed by
`ctx.configForms.get(entryId)`. The editor reads the current Host-backed
snapshot, writes a typed path operation with the snapshot revision, and can
remove a user override to restore the inherited value. It edits the real
settings entry instead of creating a second stored form. The native settings
shell remains in charge of categories, onboarding, launchers, and shortcuts.

## Host navigation boundary

The rc.2 `sidebar.settings` root owns a private `openSection(id)` store action.
`settings.launcher` receives `openSettings()` and a regular `settings.section`
owner receives only `close()`. No general section/field route service exists
in the installed declarations. The Host does expose `ConfigForms.describe()`
and `ConfigForms.get(entryId).mutate(pathOps, expectedRevision)`, so selecting
a result can open a live editor for that exact entry and field path. It cannot
switch to the entry's native settings page or focus its native row. A future
Host API could accept the stable target `{ entryId, fieldPath }` and navigate
to/focus the corresponding native editor; this package does not use DOM
selectors or duplicate the underlying setting data.

The rc.2 descriptor carries each namespace's schema and ancestor field labels,
but no separate native sidebar category registry. Results show the owning
entry id followed by schema section context.

## Marketplace decision and compatibility

The marketplace candidate `@objectivex666/dsh-settings-search` was audited
against its package manifest and shipped client. Its manifest declares no DSH
peer range and injects `@deepseek-ai/dsh-client-runtime`, which is absent from
the installed rc.2 tree. Its client indexes slot registrations plus rendered
DOM and navigates by clicking sidebar buttons and highlighting matching rows;
there is no rc.2 section-owner API for that direct jump. The candidate was not
adopted or ported; this package is built with the local `@dshfiles/dshx` fork
and the installed rc.2 `ConfigForms`/slot APIs.

Peer range: `@deepseek-ai/dsh >=0.2.0-rc.2 <0.3.0-0` and
`@deepseek-ai/dsh-client-ui-settings 0.2.0-rc.2`. The plugin owns one
`settings.section` contribution. The parent composition must add
`@dshfiles/settings-search` and its package dependency; root manifests and
profile composition are intentionally not changed here.
