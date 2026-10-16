# Repository documentation

This directory holds repository-wide operational guidance. Product and API documentation lives with its owning plugin or toolchain; active design work lives in [`plans/`](../plans/README.md).

| Document                                     | Purpose                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`profile-installs.md`](profile-installs.md) | Local profile installs, pnpm behavior, peer dependencies, and composition.                           |
| [`e2e-testing.md`](e2e-testing.md)           | Test layers, boot smoke, Gherkin journeys, feature catalogs, and run evidence.                       |
| [Incremental checks](incremental-checks.md)  | Unified pnpm workspace, Turbo caching, JJ-aware changed/related tests, and safe fallback boundaries. |
| [Client state ownership](client-state-ownership.md) | Which plugin state belongs on the Host, which belongs to a browser window, and what to move next. |
| [`scripts/README.md`](../scripts/README.md)  | Repository-level scripts and their owning workflows.                                                 |
| [Agent tool parity](agent-tool-parity.md)    | Every user-facing capability's agent tool, what is missing, and which gaps need a Host verb.          |

For the complete package guide index, see the [repository README](../README.md#owned-dsh-bundles). For dshx, see the [toolchain documentation index](../tooling/dshx/docs/index.md).
