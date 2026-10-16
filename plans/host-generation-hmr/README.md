# Host generation HMR for DSHX plugins

Objective: add an opt-in development Host generation manager for DSHX-built
plugins. Keep the production Host artifact unchanged and avoid DSH core changes.
The manager loads immutable implementation generations, disposes the active
Cordis child fiber before activation, and restores the last-known-good generation
if startup fails.

## Decisions

- Scope is DSHX-built plugins, not arbitrary profile bundles.
- The feature is opt-in and development-only; production keeps one self-contained
  `dist/index.js`.
- Support Host Config and DSHX Settings when their Loader contract is unchanged.
  A changed contract is not hot-mutable: detect it and require a normal process
  restart. Standard Schema does not provide a canonical fingerprint, so an
  explicit immutable contract/version boundary is required.
- Stabilize the DSHX Host authoring API before depending on its lifecycle surface.
- Competitor evidence: OpenCode V2 tracks code/source generations and swaps
  scoped plugin effects, but plugin options are unvalidated records; Pi reloads
  extension registrations and has per-extension staged commit/discard, but no
  extension settings schema. Neither needs a schema fingerprint. DSHX does.
  Sources: [OpenCode plugin manager](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin.ts),
  [OpenCode source watcher](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin/module.ts),
  [OpenCode options](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/options.ts),
  [Pi loader](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/loader.ts),
  [Pi lifecycle docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).
- Proposed contract rule: use a separate contract revision for Loader-facing
  `name`, `inject`, `Config`, and Settings schema. Keep it fixed for code-only
  changes; changing the contract revision requires a normal DSH process restart.
  This is not yet approved by the user.
- In-flight work is not cancelled by Fiber disposal. Plugins must own and cancel
  work through Cordis effects when replacement should stop it.
- No DSH core changes; live `:3080` must remain untouched.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Inspect DSHX and Cordis Host lifecycle | done | Cordis `ctx.plugin()` returns an awaitable Fiber with `dispose()`; a temporary native bundle replacement was proven in an isolated DSH by the investigation thread. |
| Compare OpenCode V2 and Pi reload contracts | done | OpenCode tracks code generations and restores failed activations, but has no plugin-declared settings schema. Pi replaces extension runtimes and stages each extension's registrations, but has no persisted extension-settings schema or whole-generation rollback. Neither needs a schema fingerprint. |
| Choose loader-contract fingerprint and API stability policy | in progress | User selected Config/Settings support and Host API stabilization. DSHX needs an explicit static contract boundary because Standard Schema has no canonical serialization. |
| Implement generation build protocol and manager | pending | Production single-file guard must remain strict; dev builds need immutable generation files and an atomic pointer. |
| Add rollback, lifecycle, and contract regression tests | pending | Include activation failure, rollback, Config/Settings compatibility, concurrent rebuilds, and owned cleanup. |
| Verify through isolated DSH and document behavior | pending | Same-process proof, HMR errors, restart-required contract changes, no live DSH access. |

Resume here: define the static Loader-contract descriptor and decide whether its
opaque Config/Settings schema revision is explicit or derived. Then stabilize the
`@dshfiles/dshx/host` API before implementing the generation watcher.
