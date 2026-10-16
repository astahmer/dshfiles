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
  restart. Standard Schema does not provide a canonical fingerprint, so the
  design must define an explicit immutable contract/version boundary.
- Stabilize the DSHX Host authoring API before depending on its lifecycle surface.
- In-flight work is not cancelled by Fiber disposal. Plugins must own and cancel
  work through Cordis effects when replacement should stop it.
- No DSH core changes; live `:3080` must remain untouched.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Inspect DSHX and Cordis Host lifecycle | done | Cordis `ctx.plugin()` returns an awaitable Fiber with `dispose()`; a temporary native bundle replacement was proven in an isolated DSH by the investigation thread. |
| Choose loader-contract fingerprint and API stability policy | in progress | User selected Config/Settings support and Host API stabilization; exact contract version boundary remains to be designed. |
| Implement generation build protocol and manager | pending | Production single-file guard must remain strict; dev builds need immutable generation files and an atomic pointer. |
| Add rollback, lifecycle, and contract regression tests | pending | Include activation failure, rollback, Config/Settings compatibility, concurrent rebuilds, and owned cleanup. |
| Verify through isolated DSH and document behavior | pending | Same-process proof, HMR errors, restart-required contract changes, no live DSH access. |

Resume here: design the immutable Loader-contract boundary that can detect
changes to `name`, `inject`, native `Config`, and DSHX Settings without relying on
Standard Schema object identity; then stabilize the `@dshfiles/dshx/host` API
contract before implementing the watcher protocol.
