# Settings Search

DSH 0.2 settings search indexes the redacted `ConfigForms.describe()` schema
mirror and returns stable `{ entryId, fieldPath }` identities. Search matches
field labels, descriptions, owning entry, ancestor section labels, and finite
option labels and values; letter accents are ignored. The search field focuses
when its Settings section opens. With an empty query it shows available
settings categories, using schema titles when present; choosing one browses
that entry's searchable fields. Secret paths and their descendants are
excluded.

Selecting a result opens a focused editor backed by
`ctx.configForms.get(entryId)`. The editor reads the current Host-backed
snapshot, writes a typed path operation with the snapshot revision, and can
remove a user override to restore the inherited value. Finite schema choices
open as a typed select. The selected field control receives focus when the
editor opens. It edits the real settings entry instead of creating a second
stored form. The native settings shell remains in charge of categories,
onboarding, launchers, and shortcuts.

## Host navigation boundary

The Host Settings contract routes a field target `{ entryId, fieldPath }` to a
unique `settings.section` registration that advertises the entry in
`metadata.settingsTargets`. It opens that section and delivers the same target
with a request id; the section owns locating and focusing its native control,
then acknowledges the request. When no unique section advertises the entry,
Settings Search keeps its live Host-backed editor for that exact field path.
This package does not use DOM selectors or duplicate the underlying setting
data.

The Host describe mirror carries each namespace's schema and ancestor field
labels. Settings Search uses the Host's section metadata for native routing;
results show the owning entry id followed by schema section context.

## Marketplace decision and compatibility

The marketplace candidate `@objectivex666/dsh-settings-search` was audited
against its package manifest and shipped client. Its manifest declares no DSH
peer range and injects `@deepseek-ai/dsh-client-runtime`, which is absent from
the installed rc.2 tree. Its client indexes slot registrations plus rendered
DOM and navigates by clicking sidebar buttons and highlighting matching rows;
there is no rc.2 section-owner API for that direct jump. The candidate was not
adopted or ported; this package is built with the local `@dshfiles/dshx` fork
and the installed rc.2 `ConfigForms`/slot APIs.

The published rc.2 Settings declarations do not include the target route. This
implementation depends on the companion DSH core change; the package peer
range must be raised to the release that carries that contract before
activation. The plugin owns one `settings.section` contribution. The parent
composition must add `@dshfiles/settings-search` and its package dependency;
root manifests and profile composition are intentionally not changed here.
